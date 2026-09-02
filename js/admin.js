/* ---------- admin login (real Supabase Auth accounts) ----------
   Josh invites each coworker/boss as their own user in the Supabase
   dashboard (Authentication -> Users -> Invite user) — see README. This
   page requires a live session; the subcontractors/site_visits/
   safety_documents tables' SELECT policies are restricted to the
   `authenticated` role, so a valid login is what actually gates reads
   (not just a UI prompt). Revoking someone's access = deleting their user
   in that same Supabase dashboard screen. */
const ADMIN_INSTALL_BLURB = "Keeps this separate from the subcontractor sign-in app on your phone — only people you've invited can log in.";

function renderLogin(){
  app.innerHTML = `
    ${installHintHtml('adminInstallHintDismissed', ADMIN_INSTALL_BLURB)}
    <div class="card">
      <div class="helptext">Sign in with the account Josh set up for you to view sign-ins and submitted safety forms.</div>
    </div>
    <label>Email</label>
    <input id="loginEmail" type="email" autocomplete="username">
    <label>Password</label>
    <input id="loginPassword" type="password" autocomplete="current-password">
    <button class="btn" id="loginBtn" style="width:100%; margin-top:18px;">Sign In</button>
    <div class="helptext" style="margin-top:10px;">No account? Ask Josh to invite you from the Supabase dashboard.</div>
  `;
  wireInstallHint();
  const submit = async ()=>{
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    if(!email || !password){ showToast('Enter your email and password.'); return; }
    const btn = document.getElementById('loginBtn');
    btn.disabled = true; btn.textContent = 'Signing in…';
    try{
      await adminSignIn(email, password);
      renderDashboard();
    }catch(e){
      showToast(e.message || 'Could not sign in.');
      btn.disabled = false; btn.textContent = 'Sign In';
    }
  };
  document.getElementById('loginBtn').onclick = submit;
  document.getElementById('loginPassword').onkeydown = (e)=>{ if(e.key==='Enter') submit(); };
}

/* ---------- data ---------- */
const SUB_DOC_TYPES = {
  hazard_assessment: 'Hazard Assessment',
  equipment_cert: 'Equipment Operation Certificate',
  incident_report: 'Incident Report'
};
async function fetchSubVisits(){
  return adminFetch('/rest/v1/site_visits?order=sign_in_at.desc&limit=1000&select=*');
}
async function fetchSubDocs(){
  return adminFetch('/rest/v1/safety_documents?order=uploaded_at.desc&limit=1000&select=*');
}

const MUSTER_LABELS = { site_office: 'Site Office', '81st_street': '81st Street SW' };

function mergeActivity(visits, docs){
  return [
    ...visits.map(v=>({
      ts: v.sign_in_at, name: v.subcontractor_name, company: v.subcontractor_company, label: 'Signed in',
      crewCount: v.crew_count, crewNames: v.crew_names, hadOrientation: v.had_orientation,
      musterPoint: v.muster_point, fitForWork: v.fit_for_work,
      signatureType: v.signature_type, signatureText: v.signature_text, signatureUrl: v.signature_file_url
    })),
    ...visits.filter(v=>v.sign_out_at).map(v=>({ ts: v.sign_out_at, name: v.subcontractor_name, company: v.subcontractor_company, label: 'Signed out' })),
    ...docs.map(d=>({ ts: d.uploaded_at, name: d.subcontractor_name, company: d.subcontractor_company, label: `Submitted: ${SUB_DOC_TYPES[d.type] || d.type}`, url: d.file_url, notes: d.notes }))
  ].sort((a,b)=> new Date(b.ts) - new Date(a.ts));
}

/* ---------- dashboard ---------- */
const app = document.getElementById('app');
let allVisits = [], allDocs = [];

function defaultFromDate(){
  const d = new Date(); d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0,10);
}
function todayDate(){ return new Date().toISOString().slice(0,10); }

async function renderDashboard(){
  const session = getAdminSession();
  app.innerHTML = `
    <div class="card no-print">
      <div class="row">
        <div class="item-meta">Signed in as ${escapeHtml(session ? session.email : '')}</div>
        <a href="#" id="signOutLink">Sign out</a>
      </div>
    </div>

    <div class="section-title no-print">Date Range</div>
    <div class="card no-print">
      <div style="display:flex; gap:8px;">
        <div style="flex:1;"><label>From</label><input type="date" id="fromDate" value="${defaultFromDate()}"></div>
        <div style="flex:1;"><label>To</label><input type="date" id="toDate" value="${todayDate()}"></div>
      </div>
      <div style="display:flex; gap:8px; margin-top:10px;">
        <button class="btn ghost" id="exportCsvBtn" style="flex:1;">Export CSV</button>
        <button class="btn ghost" id="printBtn" style="flex:1;">Print Report</button>
      </div>
    </div>

    <div class="section-title">On Site Now</div>
    <div id="onSite"><div class="helptext" style="margin:4px;">Loading…</div></div>
    <div class="section-title">Activity</div>
    <div id="activity"><div class="helptext" style="margin:4px;">Loading…</div></div>
  `;

  document.getElementById('signOutLink').onclick = async (e)=>{
    e.preventDefault();
    await adminSignOut();
    renderLogin();
  };
  document.getElementById('fromDate').onchange = renderFiltered;
  document.getElementById('toDate').onchange = renderFiltered;
  document.getElementById('exportCsvBtn').onclick = exportCSV;
  document.getElementById('printBtn').onclick = ()=>window.print();

  try{
    [allVisits, allDocs] = await Promise.all([fetchSubVisits(), fetchSubDocs()]);
  }catch(e){
    console.error('admin load failed', e);
    if(String(e.message).includes('signed in') || String(e.message).includes('expired')){
      showToast('Your session expired — sign in again.');
      renderLogin();
      return;
    }
    document.getElementById('onSite').innerHTML = `<div class="helptext">Couldn't load — check your connection.</div>`;
    document.getElementById('activity').innerHTML = '';
    return;
  }
  renderOnSite(allVisits);
  renderFiltered();
}

function filteredRange(){
  const from = document.getElementById('fromDate').value;
  const to = document.getElementById('toDate').value;
  const fromTs = from ? new Date(from + 'T00:00:00').getTime() : -Infinity;
  const toTs = to ? new Date(to + 'T23:59:59').getTime() : Infinity;
  return { fromTs, toTs };
}

function renderFiltered(){
  const { fromTs, toTs } = filteredRange();
  const items = mergeActivity(allVisits, allDocs).filter(it=>{
    const t = new Date(it.ts).getTime();
    return t >= fromTs && t <= toTs;
  });
  renderActivity(items);
}

function renderOnSite(visits){
  const onSite = visits.filter(v=>!v.sign_out_at);
  const el = document.getElementById('onSite');
  if(!onSite.length){ el.innerHTML = `<div class="empty">Nobody currently signed in.</div>`; return; }
  el.innerHTML = onSite.map(v=>`
    <div class="card">
      <div class="row">
        <div>
          <div style="font-weight:700;">${escapeHtml(v.subcontractor_name || 'Unknown')}</div>
          <div class="item-meta">${escapeHtml(v.subcontractor_company || '')}</div>
        </div>
        <div class="item-meta">Signed in ${new Date(v.sign_in_at).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}</div>
      </div>
    </div>
  `).join('');
}

function renderActivity(items){
  const el = document.getElementById('activity');
  if(!items.length){ el.innerHTML = `<div class="empty">No sign-ins or submissions in this range.</div>`; return; }
  el.innerHTML = items.map(it=>`
    <div class="card">
      <div class="row">
        <div>
          <div style="font-weight:700;">${escapeHtml(it.name || 'Unknown')}</div>
          <div class="item-meta">${escapeHtml(it.company || '')} · ${escapeHtml(it.label)}</div>
          ${it.notes ? `<div class="item-meta">${escapeHtml(it.notes)}</div>` : ''}
          ${it.crewCount != null ? `<div class="item-meta">Crew of ${it.crewCount}: ${escapeHtml(it.crewNames || '')}</div>` : ''}
          ${it.hadOrientation != null ? `<div class="item-meta">Orientation: ${it.hadOrientation ? 'Yes' : 'No'} · Muster point: ${escapeHtml(MUSTER_LABELS[it.musterPoint] || it.musterPoint || '')} · Fit for work: ${it.fitForWork ? 'Yes' : 'No'}</div>` : ''}
          ${it.signatureType === 'typed' ? `<div class="item-meta">Signature: <em>${escapeHtml(it.signatureText || '')}</em></div>` : ''}
          ${it.signatureType === 'drawn' && it.signatureUrl ? `<div class="item-meta">Signature: <a href="${escapeHtml(it.signatureUrl)}" target="_blank">view</a></div>` : ''}
        </div>
        <div class="item-meta" style="text-align:right; white-space:nowrap;">${new Date(it.ts).toLocaleString('en-US',{month:'short', day:'numeric', hour:'numeric', minute:'2-digit'})}</div>
      </div>
      ${it.url ? `<div class="divider" style="margin:8px 0;"></div><a href="${escapeHtml(it.url)}" target="_blank">View submitted file</a>` : ''}
    </div>
  `).join('');
}

/* ---------- CSV export ---------- */
function toCSV(items){
  const header = [
    'Timestamp', 'Name', 'Company', 'Action',
    'Crew Count', 'Crew Names', 'Orientation', 'Muster Point', 'Fit For Work', 'Signature',
    'Notes', 'File URL'
  ];
  const rows = items.map(it => [
    new Date(it.ts).toLocaleString('en-US'), it.name || '', it.company || '', it.label,
    it.crewCount ?? '', it.crewNames || '',
    it.hadOrientation == null ? '' : (it.hadOrientation ? 'Yes' : 'No'),
    MUSTER_LABELS[it.musterPoint] || it.musterPoint || '',
    it.fitForWork == null ? '' : (it.fitForWork ? 'Yes' : 'No'),
    it.signatureType === 'typed' ? it.signatureText : (it.signatureType === 'drawn' ? it.signatureUrl : ''),
    it.notes || '', it.url || ''
  ]);
  const escapeCell = v => `"${String(v).replace(/"/g, '""')}"`;
  return [header, ...rows].map(r => r.map(escapeCell).join(',')).join('\r\n');
}
function exportCSV(){
  const { fromTs, toTs } = filteredRange();
  const items = mergeActivity(allVisits, allDocs).filter(it=>{
    const t = new Date(it.ts).getTime();
    return t >= fromTs && t <= toTs;
  });
  if(!items.length){ showToast('Nothing to export in this range.'); return; }
  const from = document.getElementById('fromDate').value, to = document.getElementById('toDate').value;
  const csv = toCSV(items);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `site-signin-${from}_to_${to}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

/* ---------- init ---------- */
(async function init(){
  const session = getAdminSession();
  if(session){
    const fresh = await ensureFreshAdminSession();
    if(fresh){ renderDashboard(); return; }
  }
  renderLogin();
})();

/* Explicit narrow scope so this doesn't collide with index.html's own
   service worker registration (js/app.js -> sw.js), which defaults to
   scope '/' — without this, both registrations would key off the same
   root scope and fight over which one controls which page. */
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('admin-sw.js', { scope: './admin.html' }).catch(e=>console.error('SW registration failed', e));
  });
}
