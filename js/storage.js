/* ---------- storage helpers (Supabase-backed) ----------
   This app shares a Supabase project with Slokker's other internal tool
   (Site Log), by choice — same company data, one less thing to provision —
   but this codebase is otherwise fully independent (separate repo, no
   shared files). It uses its own tables: subcontractors / site_visits /
   safety_documents.

   Write access (insert/update) on those tables is OPEN to anyone with the
   public anon key — a subcontractor scanning the QR code has zero setup,
   so there's nothing to gate sign-in/sign-out/submissions with. READ
   access is NOT open: only logged-in reviewers (Supabase Auth, see
   js/admin.js) can query the tables back. That's why the subcontractor
   app below never reads these tables — "am I signed in" and "recent
   activity" are tracked locally on the phone instead (see the "local
   state" section). See README for the one-time Supabase setup. */
const SUPABASE_URL = 'https://iafzmkwahiusfdxodgdi.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlhZnpta3dhaGl1c2ZkeG9kZ2RpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4MTE2ODIsImV4cCI6MjEwMjM4NzY4Mn0.-9plVpsptVaOZfVrhrLOovhYuZEghGUSLFx5yr7i-HU';
const SUPABASE_HEADERS = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
const DOCS_BUCKET = 'safety-submissions';

function uid(){ return Math.random().toString(36).slice(2,10) + Date.now().toString(36).slice(-4); }

/* ---------- profile (device-local "memory") ---------- */
function getProfile(){
  try{ return JSON.parse(localStorage.getItem('subProfile') || 'null'); }
  catch(e){ return null; }
}
function saveProfile(profile){ localStorage.setItem('subProfile', JSON.stringify(profile)); }
function clearProfile(){ localStorage.removeItem('subProfile'); }

/* ---------- local state: current visit + recent activity ----------
   Tracked on-device rather than read back from Supabase, since reads now
   require an authenticated (admin) session. Written alongside every
   successful server write below, so it stays in sync with what actually
   got saved. */
function getCurrentVisit(){
  try{ return JSON.parse(localStorage.getItem('subCurrentVisit') || 'null'); }
  catch(e){ return null; }
}
function setCurrentVisit(visit){ localStorage.setItem('subCurrentVisit', JSON.stringify(visit)); }
function clearCurrentVisit(){ localStorage.removeItem('subCurrentVisit'); }

function getActivityLog(){
  try{ return JSON.parse(localStorage.getItem('subActivityLog') || '[]'); }
  catch(e){ return []; }
}
function pushActivityLog(entry){
  const log = [entry, ...getActivityLog()].slice(0, 20);
  localStorage.setItem('subActivityLog', JSON.stringify(log));
}

async function createSubcontractor(profile){
  const res = await fetch(`${SUPABASE_URL}/rest/v1/subcontractors`, {
    method: 'POST',
    headers: { ...SUPABASE_HEADERS, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify({
      id: profile.id, name: profile.name, company: profile.company || null,
      trade: profile.trade || null, phone: profile.phone || null,
      created_at: new Date().toISOString()
    })
  });
  if(!res.ok) throw new Error(`Could not save profile (${res.status})`);
}

/* ---------- site visits (sign in / sign out) ---------- */
async function signIn(profile){
  const visit = {
    id: uid(), subcontractor_id: profile.id,
    subcontractor_name: profile.name, subcontractor_company: profile.company || null,
    sign_in_at: new Date().toISOString(), sign_out_at: null
  };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/site_visits`, {
    method: 'POST',
    headers: { ...SUPABASE_HEADERS, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify(visit)
  });
  if(!res.ok) throw new Error(`Sign-in failed (${res.status})`);
  setCurrentVisit({ id: visit.id, sign_in_at: visit.sign_in_at });
  pushActivityLog({ ts: visit.sign_in_at, label: 'Signed in' });
}
async function signOut(visitId){
  const signOutAt = new Date().toISOString();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/site_visits?id=eq.${encodeURIComponent(visitId)}`, {
    method: 'PATCH',
    headers: { ...SUPABASE_HEADERS, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify({ sign_out_at: signOutAt })
  });
  if(!res.ok) throw new Error(`Sign-out failed (${res.status})`);
  clearCurrentVisit();
  pushActivityLog({ ts: signOutAt, label: 'Signed out' });
}

/* ---------- safety document submissions ---------- */
async function uploadDocFile(file){
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g,'') || 'jpg';
  const path = `${new Date().toISOString().slice(0,10)}/${uid()}.${ext}`;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${DOCS_BUCKET}/${path}`, {
    method: 'POST',
    headers: { ...SUPABASE_HEADERS, 'Content-Type': file.type || 'application/octet-stream' },
    body: file
  });
  if(!res.ok) throw new Error(`Upload failed (${res.status})`);
  return `${SUPABASE_URL}/storage/v1/object/public/${DOCS_BUCKET}/${path}`;
}
async function submitDocument(profile, type, fileUrl, notes, docTypeLabel){
  const uploadedAt = new Date().toISOString();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/safety_documents`, {
    method: 'POST',
    headers: { ...SUPABASE_HEADERS, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify({
      id: uid(), subcontractor_id: profile.id,
      subcontractor_name: profile.name, subcontractor_company: profile.company || null,
      type, file_url: fileUrl, notes: notes || null,
      uploaded_at: uploadedAt
    })
  });
  if(!res.ok) throw new Error(`Could not save submission (${res.status})`);
  pushActivityLog({ ts: uploadedAt, label: `Submitted: ${docTypeLabel}` });
}

/* ---------- admin auth (Supabase Auth, email + password) ----------
   Real per-person accounts, invited by Josh via the Supabase dashboard
   (Authentication -> Users -> Invite user) — see README. This is what
   actually gates reads: the subcontractors/site_visits/safety_documents
   SELECT policies are restricted to the `authenticated` role, so only a
   signed-in session (a valid access_token below) can read them back. */
const ADMIN_SESSION_KEY = 'adminSession';
function getAdminSession(){
  try{ return JSON.parse(localStorage.getItem(ADMIN_SESSION_KEY) || 'null'); }
  catch(e){ return null; }
}
function saveAdminSession(session){ localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(session)); }
function clearAdminSession(){ localStorage.removeItem(ADMIN_SESSION_KEY); }

async function adminSignIn(email, password){
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error_description || data.msg || 'Invalid email or password');
  const session = {
    access_token: data.access_token, refresh_token: data.refresh_token,
    expires_at: data.expires_at, email: data.user && data.user.email
  };
  saveAdminSession(session);
  return session;
}
async function adminRefreshSession(refreshToken){
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken })
  });
  if(!res.ok) return null;
  const data = await res.json();
  const session = {
    access_token: data.access_token, refresh_token: data.refresh_token,
    expires_at: data.expires_at, email: data.user && data.user.email
  };
  saveAdminSession(session);
  return session;
}
async function adminSignOut(){
  const session = getAdminSession();
  clearAdminSession();
  if(!session) return;
  try{
    await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}` }
    });
  }catch(e){ /* best-effort */ }
}

/* Ensures a live session, refreshing if the access token is expiring soon.
   Returns null (never an expired session) if it can't get one. */
async function ensureFreshAdminSession(){
  let session = getAdminSession();
  if(!session) return null;
  const expiresInMs = (session.expires_at * 1000) - Date.now();
  if(expiresInMs > 60000) return session;
  const refreshed = await adminRefreshSession(session.refresh_token);
  if(!refreshed) clearAdminSession();
  return refreshed;
}

/* GET wrapper for admin reads — attaches the current access token so RLS
   sees an `authenticated` request, refreshing it first if it's close to
   expiring. Throws if there's no valid session (caller should re-prompt
   login). */
async function adminFetch(path){
  const session = await ensureFreshAdminSession();
  if(!session) throw new Error('not signed in');
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}` }
  });
  if(res.status === 401){ clearAdminSession(); throw new Error('session expired'); }
  if(!res.ok) throw new Error(`request failed (${res.status})`);
  return res.json();
}
