-- ---------- real-time per-event activity emails ----------
-- Replaces the once-a-day digest (.github/workflows/daily-digest.yml) with
-- an email that fires the instant a sign-in, sign-out, or form submission
-- is written — straight from Postgres via the pg_net extension, since the
-- subcontractor app writes directly to Supabase with no server in that
-- path to trigger it from.
--
-- Run this whole file once in the Supabase SQL editor (Database -> SQL
-- Editor -> New query). Safe to re-run — every statement either uses
-- IF NOT EXISTS, OR REPLACE, or DROP ... IF EXISTS first.
--
-- Before running, fill in the three placeholders below:
--   YOUR_RESEND_API_KEY   - the same key already used for the old digest
--                            (resend.com dashboard -> API Keys)
--   YOUR_DESTINATION_EMAIL - where you want these emails sent
--   YOUR_FROM_EMAIL         - defaults to Resend's shared sender if you
--                              leave it as 'onboarding@resend.dev'; a
--                              verified custom domain works too

-- 1) Enable the extension that lets Postgres make outbound HTTP calls.
create extension if not exists pg_net with schema extensions;

-- 2) Store the Resend key + addresses in Supabase's encrypted secret store
--    (Vault) rather than hardcoding them into the function body below.
--    Re-running this block updates the secret if you ever need to rotate
--    the key or change the destination address.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'resend_api_key') then
    perform vault.create_secret('YOUR_RESEND_API_KEY', 'resend_api_key', 'Resend API key for real-time activity emails');
  else
    perform vault.update_secret((select id from vault.secrets where name = 'resend_api_key'), 'YOUR_RESEND_API_KEY');
  end if;

  if not exists (select 1 from vault.secrets where name = 'activity_to_email') then
    perform vault.create_secret('YOUR_DESTINATION_EMAIL', 'activity_to_email', 'Where real-time activity emails are sent');
  else
    perform vault.update_secret((select id from vault.secrets where name = 'activity_to_email'), 'YOUR_DESTINATION_EMAIL');
  end if;

  if not exists (select 1 from vault.secrets where name = 'activity_from_email') then
    perform vault.create_secret('onboarding@resend.dev', 'activity_from_email', 'Resend from-address for real-time activity emails');
  else
    perform vault.update_secret((select id from vault.secrets where name = 'activity_from_email'), 'onboarding@resend.dev');
  end if;
end $$;

-- 3) The trigger function. Fires AFTER the row is already saved, and
--    wraps everything in its own exception handler — if Resend is down,
--    the key is wrong, or anything else goes wrong in here, the sign-in
--    or submission that triggered it has already been committed and is
--    completely unaffected. A notification failure is logged as a
--    Postgres warning (visible in Supabase's log explorer) and otherwise
--    silently skipped, never surfaced to the subcontractor's app.
create or replace function public.notify_site_activity()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault, net
as $$
declare
  v_resend_key text;
  v_to_email text;
  v_from_email text;
  v_subject text;
  v_html text;
  v_site_label text;
  v_type_label text;
  v_muster_label text;
begin
  begin
    select decrypted_secret into v_resend_key from vault.decrypted_secrets where name = 'resend_api_key';
    select decrypted_secret into v_to_email from vault.decrypted_secrets where name = 'activity_to_email';
    select decrypted_secret into v_from_email from vault.decrypted_secrets where name = 'activity_from_email';

    if v_resend_key is null or v_to_email is null or v_resend_key = 'YOUR_RESEND_API_KEY' or v_to_email = 'YOUR_DESTINATION_EMAIL' then
      raise warning 'notify_site_activity: Resend key/destination not configured yet, skipping';
      return coalesce(new, old);
    end if;
    v_from_email := coalesce(nullif(v_from_email, ''), 'onboarding@resend.dev');

    -- Keep this in sync with SITES in js/app.js and SITE_LABELS in
    -- scripts/daily-digest.js — same site keys either place.
    v_site_label := case new.site
      when 'juniper' then 'Juniper Townhomes'
      when 'aurora' then 'Aurora Townhomes'
      else coalesce(new.site, 'Unknown site')
    end;

    if TG_TABLE_NAME = 'site_visits' then
      if TG_OP = 'INSERT' then
        v_muster_label := case new.muster_point
          when 'site_office' then 'Site Office'
          when '81st_street' then '81st Street SW'
          else coalesce(new.muster_point, '')
        end;
        v_subject := coalesce(new.subcontractor_name, 'Unknown') || ' signed in — ' || v_site_label;
        v_html :=
          '<h2 style="font-family:sans-serif;color:#1F5C60;margin:0 0 12px;">Signed in</h2>' ||
          '<div style="font-family:sans-serif; font-size:14px; color:#1B2B2C;">' ||
          '<div style="font-weight:700;">' || coalesce(new.subcontractor_name, 'Unknown') || '</div>' ||
          '<div style="color:#5C7778; font-size:12px;">' || coalesce(new.subcontractor_company, '') ||
            ' &middot; ' || v_site_label || ' &middot; ' || new.sign_in_at::text || '</div>' ||
          '<div style="font-size:12px; margin-top:6px;">Crew of ' || coalesce(new.crew_count::text, '') ||
            ': ' || coalesce(new.crew_names, '') || '</div>' ||
          '<div style="font-size:12px; margin-top:4px;">Orientation: ' ||
            (case when new.had_orientation then 'Yes' else 'No' end) ||
            ' &middot; Muster point: ' || v_muster_label ||
            ' &middot; Fit for work: ' || (case when new.fit_for_work then 'Yes' else 'No' end) || '</div>' ||
          '</div>';
      elsif TG_OP = 'UPDATE' and old.sign_out_at is null and new.sign_out_at is not null then
        v_subject := coalesce(new.subcontractor_name, 'Unknown') || ' signed out — ' || v_site_label;
        v_html :=
          '<h2 style="font-family:sans-serif;color:#1F5C60;margin:0 0 12px;">Signed out</h2>' ||
          '<div style="font-family:sans-serif; font-size:14px; color:#1B2B2C;">' ||
          '<div style="font-weight:700;">' || coalesce(new.subcontractor_name, 'Unknown') || '</div>' ||
          '<div style="color:#5C7778; font-size:12px;">' || coalesce(new.subcontractor_company, '') ||
            ' &middot; ' || v_site_label || ' &middot; ' || new.sign_out_at::text || '</div>' ||
          '</div>';
      else
        -- some other UPDATE we don't email about (e.g. none currently exist)
        return coalesce(new, old);
      end if;

    elsif TG_TABLE_NAME = 'safety_documents' and TG_OP = 'INSERT' then
      v_type_label := case new.type
        when 'hazard_assessment' then 'Hazard Assessment'
        when 'equipment_cert' then 'Equipment Operation Certificate'
        when 'incident_report' then 'Incident Report'
        else coalesce(new.type, 'Submission')
      end;
      v_subject := v_type_label || ' from ' || coalesce(new.subcontractor_name, 'Unknown') || ' — ' || v_site_label;
      v_html :=
        '<h2 style="font-family:sans-serif;color:#1F5C60;margin:0 0 12px;">' || v_type_label || ' submitted</h2>' ||
        '<div style="font-family:sans-serif; font-size:14px; color:#1B2B2C;">' ||
        '<div style="font-weight:700;">' || coalesce(new.subcontractor_name, 'Unknown') || '</div>' ||
        '<div style="color:#5C7778; font-size:12px;">' || coalesce(new.subcontractor_company, '') ||
          ' &middot; ' || v_site_label || ' &middot; ' || new.uploaded_at::text || '</div>' ||
        (case when new.notes is not null and new.notes <> '' then '<div style="font-size:12px; margin-top:6px;">' || new.notes || '</div>' else '' end) ||
        (case when new.file_url is not null then '<div style="margin-top:8px;"><a href="' || new.file_url || '">View submitted file</a></div>' else '' end) ||
        '</div>';
    else
      return coalesce(new, old);
    end if;

    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_resend_key, 'Content-Type', 'application/json'),
      body := jsonb_build_object('from', v_from_email, 'to', jsonb_build_array(v_to_email), 'subject', v_subject, 'html', v_html)
    );

  exception when others then
    -- Never let a notification failure touch the triggering sign-in/
    -- submission — it's already been committed by the time this runs.
    raise warning 'notify_site_activity failed: %', SQLERRM;
  end;

  return coalesce(new, old);
end;
$$;

-- 4) Attach the trigger to both tables.
drop trigger if exists site_visits_notify on public.site_visits;
create trigger site_visits_notify
after insert or update on public.site_visits
for each row execute function public.notify_site_activity();

drop trigger if exists safety_documents_notify on public.safety_documents;
create trigger safety_documents_notify
after insert on public.safety_documents
for each row execute function public.notify_site_activity();
