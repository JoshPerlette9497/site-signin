# Site Sign-In — Subcontractor Safety Log

A standalone PWA for subcontractors to sign in/out of a construction site
and submit hazard assessments, equipment operation certificates, and
incident reports from their own phone — reached via a QR code, with no
account or login required.

This is a **separate project** from Josh's Site Log superintendent tool
(`site-tracker` repo) — different repo, different deployment, no shared
files. It only shares the same Supabase project as its data backend (by
choice, to avoid provisioning a second one), in its own tables.

## What it does
- **Sign in / sign out** of the site, timestamped.
- **Submit a form**: Hazard Assessment, Equipment Operation Certificate, or
  Incident Report — photographed or scanned from the phone, uploaded
  straight from the browser (`<input capture="environment">` opens the
  camera directly on mobile).
- **One-time profile, remembered per phone.** First visit asks for name,
  company, trade, phone; saved to `localStorage` so every later visit on
  that phone skips straight to sign-in. "Not you? Switch profile" clears it
  for a shared device.
- **`admin.html`** — Josh's read-only view of who's currently on site and
  everything submitted, with links to the uploaded files.
- **`qr.html`** — printable QR code page pointing at the sign-in app; post
  it at the site entrance/trailer.

## Architecture
Plain static HTML/CSS/JS, no build step, no framework — same style as the
Site Log app it's a sibling to. Deploy target is GitHub Pages.

- `index.html` / `style.css` / `manifest.json` / `sw.js` — the subcontractor-facing app
- `admin.html` — Josh's review view
- `qr.html` — printable QR code
- `js/storage.js` — Supabase config + all data access (profile, sign in/out, document upload/submit)
- `js/modal.js` — modal/toast/confirm helpers + `escapeHtml`
- `js/app.js` — subcontractor app UI (setup, home, submit flow)
- `js/admin.js` — admin view UI + access-code gate

## Data / Storage
Uses the same Supabase project as the Site Log app
(`https://iafzmkwahiusfdxodgdi.supabase.co`), but its own tables:

- `subcontractors` — one row per profile (name, company, trade, phone)
- `site_visits` — sign in/out timestamps
- `safety_documents` — submitted form metadata + uploaded file URL

These tables use **open** RLS policies (no passphrase header) — a
subcontractor scanning the QR code has zero setup, so there's nothing to
gate their reads/writes with. This is a deliberate departure from the Site
Log app's `x-site-key`-gated `app_data` table.

### One-time Supabase setup
Run once in the Supabase SQL editor:

```sql
create table if not exists subcontractors (
  id text primary key,
  name text not null,
  company text,
  trade text,
  phone text,
  created_at timestamptz not null default now()
);

create table if not exists site_visits (
  id text primary key,
  subcontractor_id text not null,
  subcontractor_name text,
  subcontractor_company text,
  sign_in_at timestamptz not null,
  sign_out_at timestamptz
);

create table if not exists safety_documents (
  id text primary key,
  subcontractor_id text not null,
  subcontractor_name text,
  subcontractor_company text,
  type text not null, -- 'hazard_assessment' | 'equipment_cert' | 'incident_report'
  file_url text not null,
  notes text,
  uploaded_at timestamptz not null
);

alter table subcontractors enable row level security;
alter table site_visits enable row level security;
alter table safety_documents enable row level security;

create policy "public insert subcontractors" on subcontractors for insert with check (true);
create policy "public select subcontractors" on subcontractors for select using (true);

create policy "public insert site_visits" on site_visits for insert with check (true);
create policy "public select site_visits" on site_visits for select using (true);
create policy "public update site_visits" on site_visits for update using (true);

create policy "public insert safety_documents" on safety_documents for insert with check (true);
create policy "public select safety_documents" on safety_documents for select using (true);
```

Then **Storage → New bucket** named exactly `safety-submissions`, set to
**Public bucket** (same reasoning as the Site Log app's `hazard-photos`
bucket — the anon key is already public by design; this isn't a new
exposure).

Until these exist, `index.html` loads fine but every sign-in/sign-out and
form submission fails with a toast — nothing else breaks.

### Tradeoff to know
Because these policies are wide open (anyone with the anon key — which is
public in this repo's source — can read or insert rows), this extends the
Site Log app's existing public-repo trust model to data that includes
subcontractor names, phone numbers, and photographed
certificates/incident reports. It isn't encrypted-at-rest-from-Supabase or
access-controlled beyond that. Fine for this app's current risk tolerance;
worth revisiting (e.g. real Supabase Auth) before treating it as a system
of record for anything more sensitive.

## Admin access (`admin.html`)
Not a real access-control boundary — the tables above are open, so anyone
with the anon key could still query them directly with their own script.
`admin.html`'s access-code prompt only keeps casual visitors to this public
repo from seeing subcontractor data at a glance in the browser.

It reuses the **same access code** as the Site Log app's `app_data` table
(same Supabase project, already set up there) — typing it does a real
write+read round trip against `app_data` with the `x-site-key` header, same
mechanism Site Log itself uses. No separate code to remember, no new
Supabase setup for this part.

## Regenerating the QR code
`qr.html` has the QR SVG hardcoded, generated once with the `qrcode` npm
package pointed at `https://joshperlette9497.github.io/site-signin/`. If
that URL ever changes:
```
npx qrcode -o out.svg 'https://<new-url>/'
```
then replace the `<svg>...</svg>` markup in `qr.html` with the new file's
contents.

## Deployment
- **GitHub**: public repo `JoshPerlette9497/site-signin` (public so GitHub
  Pages can serve it for free — Pages on private repos needs a paid plan).
- **GitHub Pages**: enable under Settings → Pages → Deploy from a branch →
  `main` / root. No build step.
- Once live, the app/admin/QR URLs are:
  - Sign-in app: `https://joshperlette9497.github.io/site-signin/`
  - Admin view: `https://joshperlette9497.github.io/site-signin/admin.html`
  - Printable QR: `https://joshperlette9497.github.io/site-signin/qr.html`
