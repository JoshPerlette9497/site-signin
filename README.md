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
- **Sign in** — a mandatory daily questionnaire (see "Daily sign-in form"
  below) plus a signature, then timestamped. **Sign out** is a single tap.
- **Submit a form**: Hazard Assessment, Equipment Operation Certificate, or
  Incident Report — photographed or scanned from the phone, uploaded
  straight from the browser (`<input capture="environment">` opens the
  camera directly on mobile).
- **One-time profile, remembered per phone.** First visit asks for name,
  company, trade, phone; saved to `localStorage` so every later visit on
  that phone skips straight to sign-in. "Not you? Switch profile" clears it
  for a shared device.
- **`admin.html`** — a real login (per-person Supabase account) for
  reviewing who's currently on site, the full activity history, and every
  submitted file, with a date-range filter, CSV export, and print view for
  handing to a safety auditor. Installs as its **own** separate home-screen
  app (different icon/name from the subcontractor one), so it's not sitting
  inside the app regular workers use.
- **`qr.html`** — printable QR code page pointing at the sign-in app; post
  it at the site entrance/trailer.

## Architecture
Plain static HTML/CSS/JS, no build step, no framework — same style as the
Site Log app it's a sibling to. Deploy target is GitHub Pages.

This is really **two independent installable PWAs sharing one repo/deploy**
— the subcontractor app and the admin dashboard each have their own
manifest, icon, and service worker (with the admin one explicitly scoped to
just `admin.html`, so the two service workers don't collide over the same
root scope). Nothing links between them in the UI — a subcontractor using
the sign-in app has no path to `admin.html` short of typing the URL, and
even then, the login screen (backed by a real Supabase account, not a
shared code) is what actually stops them, not obscurity.

- `index.html` / `style.css` / `manifest.json` / `sw.js` — the subcontractor-facing app
- `admin.html` / `admin-manifest.json` / `admin-sw.js` / `admin-icon-*.png` — the review dashboard (login required), installable separately
- `qr.html` — printable QR code
- `js/storage.js` — Supabase config, subcontractor-flow data access (profile, sign in/out, document upload/submit, local status/activity tracking), and admin auth (Supabase Auth session handling)
- `js/modal.js` — modal/toast/confirm helpers, `escapeHtml`, and the shared "Add to Home Screen" hint (used by both `index.html` and `admin.html`, each with its own dismiss key/blurb)
- `js/app.js` — subcontractor app UI (setup, home, sign-in form, submit flow)
- `js/admin.js` — admin login + dashboard UI (date filter, CSV export, print)

## Data / Storage
Uses the same Supabase project as the Site Log app
(`https://iafzmkwahiusfdxodgdi.supabase.co`), but its own tables:

- `subcontractors` — one row per profile (name, company, trade, phone)
- `site_visits` — sign in/out timestamps
- `safety_documents` — submitted form metadata + uploaded file URL

**Writes are open, reads require login.** INSERT/UPDATE on these tables are
open to anyone with the public anon key — a subcontractor scanning the QR
code has zero setup, so there's nothing to gate sign-in/sign-out/submission
with. SELECT is restricted to the `authenticated` Supabase role — only
someone logged into `admin.html` with a real account can read the data
back. (Because reads are locked down, the subcontractor app itself never
reads these tables — "am I signed in" and "recent activity" are tracked
locally in `localStorage` on the phone instead; see `js/storage.js`.)

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

-- Anyone (the QR-code subcontractor app, no login) can write.
create policy "public insert subcontractors" on subcontractors for insert with check (true);
create policy "public insert site_visits" on site_visits for insert with check (true);
create policy "public update site_visits" on site_visits for update using (true);
create policy "public insert safety_documents" on safety_documents for insert with check (true);

-- Only a logged-in admin account can read.
create policy "authenticated select subcontractors" on subcontractors for select to authenticated using (true);
create policy "authenticated select site_visits" on site_visits for select to authenticated using (true);
create policy "authenticated select safety_documents" on safety_documents for select to authenticated using (true);
```

Then **Storage → New bucket** named exactly `safety-submissions`, set to
**Public bucket** (same reasoning as the Site Log app's `hazard-photos`
bucket — the anon key is already public by design; this isn't a new
exposure, and it's what lets `admin.html`'s "View submitted file" links
work with a plain URL).

### Migration: daily sign-in form columns
The sign-in flow now collects a full daily questionnaire + signature (see
below), stored on `site_visits`. Run this once, in addition to the table
above (safe to run even if you already ran the original `create table` —
`add column if not exists` won't touch existing rows):

```sql
alter table site_visits
  add column if not exists crew_count integer,
  add column if not exists crew_names text,
  add column if not exists had_orientation boolean,
  add column if not exists muster_point text,
  add column if not exists fit_for_work boolean,
  add column if not exists signature_type text, -- 'drawn' | 'typed'
  add column if not exists signature_text text,
  add column if not exists signature_file_url text;
```

No new bucket needed — drawn signatures upload into the same
`safety-submissions` bucket, under a `signatures/` folder.

## Daily sign-in form
Tapping **Sign In** now opens a required questionnaire before the sign-in
is recorded:
- How many workers are on the crew today (number)
- First and last names of all crew members (free text)
- Whether they've received orientation on this site (Yes/No) — recorded,
  does not block sign-in on its own
- Where the muster point is located — **Site Office** or **81st Street SW**.
  **81st Street SW is the only correct answer.** Choosing Site Office shows
  a red warning and blocks sign-in until corrected — the intent being that
  someone who doesn't know the real muster point needs a site orientation
  from their supervisor before they start work, not just an app screen.
- A fit-for-work / site-rules acknowledgment (Yes/No). **Choosing "No" also
  blocks sign-in**, with a message pointing them to their supervisor —
  this was my judgment call (not explicitly specified), on the reasoning
  that an acknowledgment someone can decline and still sign in isn't really
  an acknowledgment. Easy to change to non-blocking (just recorded) if
  that's not what you want — say the word.
- A signature — draw with a finger/stylus on a canvas, or tap "Type
  instead" for a typed name. Drawn signatures upload as a PNG to Storage;
  typed ones are stored as plain text. Both are shown/exportable from
  `admin.html`.

All of this is stored per sign-in on `site_visits` and surfaced in
`admin.html`'s activity feed and CSV export, so a specific day's crew
count, names, orientation/fit-for-work answers, and signature are all part
of the audit record — not just "so-and-so signed in at 7:03am."

Sign-out stays a single tap — no questionnaire, since the crew/orientation
info doesn't change mid-day.

Until these exist, `index.html` loads fine but every sign-in/sign-out and
form submission fails with a toast — nothing else breaks.

## Admin accounts (`admin.html`) — real per-person logins
`admin.html` requires signing in with a Supabase Auth account. This is a
genuine access-control boundary (unlike a client-side passphrase): the
SELECT policies above only grant read access to the `authenticated` role,
so without a valid login the data cannot be read back at all — not even by
someone with the anon key inspecting network requests.

**Setup (one time, in the Supabase dashboard):**
1. **Authentication → Providers → Email** — confirm Email is enabled
   (on by default).
2. **Authentication → Settings → User Signups → disable "Allow new users to
   sign up."** This is important: if public signup stays on, *anyone* could
   create their own account and read the data, defeating the point of
   locking reads to `authenticated`. Only admin-invited accounts should
   exist.
3. **Authentication → Users → Add user → Invite user** — do this once for
   yourself and once per coworker/boss who needs access. Each person gets
   an email with a link to set their own password; after that they sign
   into `admin.html` with their email + that password.

**Revoking access:** delete the person's user in that same Authentication →
Users screen. Immediate — their session stops being able to read data next
time their token needs refreshing (tokens are short-lived, so this takes
effect quickly even if they don't explicitly log out).

**Installing it:** open `https://joshperlette9497.github.io/site-signin/admin.html`
in Safari/Chrome and use "Add to Home Screen" (same steps as the
subcontractor app — the page itself shows a hint with instructions). It
installs as its own icon labeled "Admin," visually marked with a gold badge
so it doesn't look like the subcontractor app's icon at a glance. Each
invited person does this on their own phone/browser.

**Forgotten passwords:** no self-service reset flow is built into this app;
have them ask you to resend an invite (or add Supabase's password-reset
email flow later if this comes up often).

## Reviewing records / audits
`admin.html`, once logged in, shows:
- **On Site Now** — anyone with an open sign-in and no sign-out yet.
- **Activity**, filterable by date range — every sign-in, sign-out, and
  form submission, with a link to view each submitted file.
- **Export CSV** — downloads the currently-filtered range as a CSV
  (timestamp, name, company, action, notes, file URL) — hand this directly
  to a safety auditor.
- **Print Report** — a clean, printable version of the same filtered list
  (browser print → save as PDF works too).

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
  Being public is fine: the source being visible doesn't expose any data —
  writes need nothing secret, and reads need a real login the repo doesn't
  contain.
- **GitHub Pages**: enable under Settings → Pages → Deploy from a branch →
  `main` / root. No build step.
- Once live, the app/admin/QR URLs are:
  - Sign-in app: `https://joshperlette9497.github.io/site-signin/`
  - Admin dashboard: `https://joshperlette9497.github.io/site-signin/admin.html`
  - Printable QR: `https://joshperlette9497.github.io/site-signin/qr.html`
