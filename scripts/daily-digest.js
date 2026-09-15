#!/usr/bin/env node
/* ---------- daily activity digest ----------
   Run on a schedule by .github/workflows/daily-digest.yml (GitHub Actions),
   not from the browser app. Fetches the last 24h of sign-ins/sign-outs/
   submissions with the Supabase service_role key (bypasses RLS — that's
   fine here since this only ever runs server-side in GitHub's runner, never
   shipped to a browser) and emails a digest via Resend.

   Required environment variables (set as GitHub repo secrets — see README):
     SUPABASE_SERVICE_ROLE_KEY  - Supabase dashboard -> Project Settings -> API
     RESEND_API_KEY             - resend.com dashboard -> API Keys
     DIGEST_TO_EMAIL            - where the digest gets sent
   Optional:
     DIGEST_FROM_EMAIL          - defaults to Resend's shared test sender,
                                   which works with zero setup but shows as
                                   "onboarding@resend.dev"; set this once a
                                   custom domain is verified in Resend for a
                                   nicer from-address.
*/

const SUPABASE_URL = 'https://iafzmkwahiusfdxodgdi.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const TO_EMAIL = process.env.DIGEST_TO_EMAIL;
const FROM_EMAIL = process.env.DIGEST_FROM_EMAIL || 'onboarding@resend.dev';

const DOC_TYPES = {
  hazard_assessment: 'Hazard Assessment',
  equipment_cert: 'Equipment Operation Certificate',
  incident_report: 'Incident Report'
};
const MUSTER_LABELS = { site_office: 'Site Office', '81st_street': '81st Street SW' };

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function isImage(url) {
  return /\.(jpe?g|png|gif|webp|heic|heif)(\?|$)/i.test(url || '');
}

async function fetchActivity() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const headers = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` };

  const visitsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/site_visits?or=(sign_in_at.gte.${since},sign_out_at.gte.${since})&order=sign_in_at.desc&select=*`,
    { headers }
  );
  if (!visitsRes.ok) throw new Error(`site_visits fetch failed (${visitsRes.status}): ${await visitsRes.text()}`);
  const visits = await visitsRes.json();

  const docsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/safety_documents?uploaded_at=gte.${since}&order=uploaded_at.desc&select=*`,
    { headers }
  );
  if (!docsRes.ok) throw new Error(`safety_documents fetch failed (${docsRes.status}): ${await docsRes.text()}`);
  const docs = await docsRes.json();

  const sinceTs = new Date(since).getTime();
  const items = [];

  (visits || []).forEach(v => {
    if (new Date(v.sign_in_at).getTime() >= sinceTs) {
      items.push({
        ts: v.sign_in_at, name: v.subcontractor_name, company: v.subcontractor_company, label: 'Signed in',
        crewCount: v.crew_count, crewNames: v.crew_names, hadOrientation: v.had_orientation,
        musterPoint: v.muster_point, fitForWork: v.fit_for_work,
        signatureType: v.signature_type, signatureText: v.signature_text, signatureUrl: v.signature_file_url
      });
    }
    if (v.sign_out_at && new Date(v.sign_out_at).getTime() >= sinceTs) {
      items.push({ ts: v.sign_out_at, name: v.subcontractor_name, company: v.subcontractor_company, label: 'Signed out' });
    }
  });

  (docs || []).forEach(d => {
    items.push({
      ts: d.uploaded_at, name: d.subcontractor_name, company: d.subcontractor_company,
      label: `Submitted: ${DOC_TYPES[d.type] || d.type}`, url: d.file_url, notes: d.notes
    });
  });

  items.sort((a, b) => new Date(b.ts) - new Date(a.ts));
  return items;
}

function buildEmail(items) {
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  let html = `<h2 style="font-family:sans-serif;color:#1F5C60;margin:0 0 12px;">Site Sign-In — Daily Activity (${esc(today)})</h2>`;

  if (!items.length) {
    html += `<p style="font-family:sans-serif;color:#5C7778;">No sign-ins, sign-outs, or submissions in the past 24 hours.</p>`;
  } else {
    html += `<div style="font-family:sans-serif; font-size:14px; color:#1B2B2C;">`;
    items.forEach(it => {
      html += `<div style="border:1px solid #D8E4E4; border-radius:8px; padding:12px; margin-bottom:10px;">`;
      html += `<div style="font-weight:700;">${esc(it.name || 'Unknown')}</div>`;
      html += `<div style="color:#5C7778; font-size:12px;">${esc(it.company || '')} &middot; ${esc(it.label)} &middot; ${esc(new Date(it.ts).toLocaleString('en-US'))}</div>`;
      if (it.notes) html += `<div style="font-size:12px; margin-top:4px;">${esc(it.notes)}</div>`;
      if (it.crewCount != null) html += `<div style="font-size:12px; margin-top:4px;">Crew of ${esc(it.crewCount)}: ${esc(it.crewNames || '')}</div>`;
      if (it.hadOrientation != null) {
        html += `<div style="font-size:12px; margin-top:4px;">Orientation: ${it.hadOrientation ? 'Yes' : 'No'} &middot; Muster point: ${esc(MUSTER_LABELS[it.musterPoint] || it.musterPoint || '')} &middot; Fit for work: ${it.fitForWork ? 'Yes' : 'No'}</div>`;
      }
      if (it.signatureType === 'typed') {
        html += `<div style="font-size:12px; margin-top:4px;">Signature: <em>${esc(it.signatureText || '')}</em></div>`;
      }
      if (it.signatureType === 'drawn' && it.signatureUrl) {
        html += `<div style="font-size:12px; margin-top:4px;">Signature:<br><img src="${esc(it.signatureUrl)}" style="max-width:180px; max-height:70px; border:1px solid #D8E4E4; border-radius:6px; margin-top:4px;"></div>`;
      }
      if (it.url) {
        if (isImage(it.url)) {
          html += `<img src="${esc(it.url)}" style="max-width:100%; max-height:320px; border-radius:8px; border:1px solid #D8E4E4; margin-top:8px; display:block;">`;
        } else {
          html += `<div style="margin-top:8px;"><a href="${esc(it.url)}">View submitted file</a></div>`;
        }
      }
      html += `</div>`;
    });
    html += `</div>`;
  }

  return { subject: `Site Sign-In Daily Digest — ${today}`, html };
}

async function sendEmail({ subject, html }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_EMAIL, to: [TO_EMAIL], subject, html })
  });
  if (!res.ok) throw new Error(`Resend send failed (${res.status}): ${await res.text()}`);
  return res.json();
}

(async () => {
  for (const [name, val] of Object.entries({ SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY, RESEND_API_KEY, DIGEST_TO_EMAIL: TO_EMAIL })) {
    if (!val) { console.error(`Missing required environment variable: ${name}`); process.exit(1); }
  }
  const items = await fetchActivity();
  const email = buildEmail(items);
  const result = await sendEmail(email);
  console.log(`Sent digest with ${items.length} item(s) to ${TO_EMAIL}. Resend id: ${result.id || '(unknown)'}`);
})().catch(e => {
  console.error('Daily digest failed:', e.message);
  process.exit(1);
});
