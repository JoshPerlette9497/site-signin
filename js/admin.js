/* ---------- admin gate ----------
   Not a real access-control boundary — the subcontractor tables have open
   RLS (they have to, for the zero-setup QR flow), so anyone with the anon
   key could still query them directly. This just keeps casual visitors to
   this public repo's admin.html from seeing subcontractor data at a glance.
   It reuses the SAME access code as the Site Log app's `app_data` table
   (same Supabase project, already set up there) purely as a "type the code
   you already know" check, verified with a real write+read round trip. */
const ADMIN_KEY_STORAGE = 'siteSigninAdminKey';
function getAdminKey(){ return localStorage.getItem(ADMIN_KEY_STORAGE) || ''; }
function setAdminKey(key){ localStorage.setItem(ADMIN_KEY_STORAGE, key); }
function clearAdminKey(){ localStorage.removeItem(ADMIN_KEY_STORAGE); }

async function verifyAdminKey(key){
  try{
    const writeRes = await fetch(`${SUPABASE_URL}/rest/v1/app_data`, {
      method: 'POST',
      headers: {
        ...SUPABASE_HEADERS, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates',
        'x-site-key': key
      },
      body: JSON.stringify({key:'__admin_key_check', value: JSON.stringify('ok'), updated_at: new Date().toISOString()})
    });
    if(writeRes.status===401 || writeRes.status===403) return 'rejected';
    if(!writeRes.ok) return 'unknown';
    return 'ok';
  }catch(e){ return 'unknown'; }
}

function promptAdminKeyModal(){
  return new Promise(resolve=>{
    showModal(`
      <h2>Access Code Required</h2>
      <div class="helptext" style="margin-bottom:8px;">Enter the Site Log access code to view sign-ins and submissions.</div>
      <input id="adminKeyInput" type="password" autocomplete="off">
      <button class="btn" id="adminKeyOk" style="width:100%; margin-top:14px;">Continue</button>
    `);
    document.getElementById('modalClose').style.display = 'none';
    document.getElementById('modalBg').onclick = null;
    const input = document.getElementById('adminKeyInput');
    input.focus();
    const submit = ()=>{ const v = input.value.trim(); if(!v) return; closeModal(); resolve(v); };
    document.getElementById('adminKeyOk').onclick = submit;
    input.onkeydown = (e)=>{ if(e.key==='Enter') submit(); };
  });
}

async function ensureAdminKey(){
  let key = getAdminKey();
  while(true){
    if(key){
      const result = await verifyAdminKey(key);
      if(result==='ok' || result==='unknown') return;
      clearAdminKey();
      showToast('Access code rejected — try again.');
      key = null;
    }
    key = await promptAdminKeyModal();
    setAdminKey(key);
  }
}

/* ---------- data ---------- */
const SUB_DOC_TYPES = {
  hazard_assessment: 'Hazard Assessment',
  equipment_cert: 'Equipment Operation Certificate',
  incident_report: 'Incident Report'
};
async function fetchSubVisits(){
  const res = await fetch(`${SUPABASE_URL}/rest/v1/site_visits?order=sign_in_at.desc&limit=100&select=*`, { headers: SUPABASE_HEADERS });
  if(!res.ok) throw new Error('site_visits fetch failed: ' + res.status);
  return res.json();
}
async function fetchSubDocs(){
  const res = await fetch(`${SUPABASE_URL}/rest/v1/safety_documents?order=uploaded_at.desc&limit=50&select=*`, { headers: SUPABASE_HEADERS });
  if(!res.ok) throw new Error('safety_documents fetch failed: ' + res.status);
  return res.json();
}

const app = document.getElementById('app');

async function render(){
  app.innerHTML = `
    <div class="section-title">On Site Now</div>
    <div id="onSite"><div class="helptext" style="margin:4px;">Loading…</div></div>
    <div class="section-title">Recent Activity</div>
    <div id="activity"><div class="helptext" style="margin:4px;">Loading…</div></div>
    <div class="divider"></div>
    <div class="helptext" style="margin:0 4px;"><a href="#" id="clearKeyLink">Clear saved access code on this device</a></div>
  `;
  document.getElementById('clearKeyLink').onclick = (e)=>{
    e.preventDefault();
    showConfirm('Clear the saved access code on this device? You will need to re-enter it.', ()=>{
      clearAdminKey();
      location.reload();
    });
  };
  try{
    const [visits, docs] = await Promise.all([fetchSubVisits(), fetchSubDocs()]);
    renderOnSite(visits);
    renderActivity(visits, docs);
  }catch(e){
    console.error('admin load failed', e);
    document.getElementById('onSite').innerHTML = `<div class="helptext">Couldn't load — check your connection.</div>`;
    document.getElementById('activity').innerHTML = '';
  }
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

function renderActivity(visits, docs){
  const items = [
    ...visits.map(v=>({ ts: v.sign_in_at, name: v.subcontractor_name, company: v.subcontractor_company, label: 'Signed in' })),
    ...visits.filter(v=>v.sign_out_at).map(v=>({ ts: v.sign_out_at, name: v.subcontractor_name, company: v.subcontractor_company, label: 'Signed out' })),
    ...docs.map(d=>({ ts: d.uploaded_at, name: d.subcontractor_name, company: d.subcontractor_company, label: `Submitted: ${SUB_DOC_TYPES[d.type] || d.type}`, url: d.file_url, notes: d.notes }))
  ].sort((a,b)=> new Date(b.ts) - new Date(a.ts)).slice(0, 60);

  const el = document.getElementById('activity');
  if(!items.length){ el.innerHTML = `<div class="empty">No sign-ins or submissions yet.</div>`; return; }
  el.innerHTML = items.map(it=>`
    <div class="card">
      <div class="row">
        <div>
          <div style="font-weight:700;">${escapeHtml(it.name || 'Unknown')}</div>
          <div class="item-meta">${escapeHtml(it.company || '')} · ${it.label}</div>
          ${it.notes ? `<div class="item-meta">${escapeHtml(it.notes)}</div>` : ''}
        </div>
        <div class="item-meta" style="text-align:right; white-space:nowrap;">${new Date(it.ts).toLocaleString('en-US',{month:'short', day:'numeric', hour:'numeric', minute:'2-digit'})}</div>
      </div>
      ${it.url ? `<div class="divider" style="margin:8px 0;"></div><a href="${escapeHtml(it.url)}" target="_blank">View submitted file</a>` : ''}
    </div>
  `).join('');
}

(async function init(){
  await ensureAdminKey();
  render();
})();
