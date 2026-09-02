const app = document.getElementById('app');
const TRADES = [
  'Framing','Concrete','Excavation','Electrical','Plumbing','HVAC','Drywall','Painting',
  'Roofing','Insulation','Flooring','Masonry','Landscaping','Glazing','Elevator','Other'
];
const DOC_TYPES = {
  hazard_assessment: 'Hazard Assessment',
  equipment_cert: 'Equipment Operation Certificate',
  incident_report: 'Incident Report'
};

function setHeader(sub){
  document.getElementById('headerSub').textContent = sub;
}

/* ---------- setup (one-time profile) ---------- */
function renderSetup(){
  setHeader('Quick one-time setup');
  app.innerHTML = `
    <div class="card">
      <div class="helptext">This only takes a moment. Your info is saved on this phone, so you won't have to enter it again on future visits.</div>
    </div>
    <label>Your Name *</label>
    <input id="setupName" type="text" autocomplete="name" placeholder="Full name">
    <label>Company</label>
    <input id="setupCompany" type="text" autocomplete="organization" placeholder="Subcontractor company">
    <label>Trade</label>
    <select id="setupTrade">
      <option value="">Select trade…</option>
      ${TRADES.map(t=>`<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('')}
    </select>
    <label>Phone</label>
    <input id="setupPhone" type="tel" autocomplete="tel" placeholder="(optional)">
    <button class="btn" id="setupSubmit" style="width:100%; margin-top:18px;">Continue</button>
  `;
  document.getElementById('setupSubmit').onclick = async ()=>{
    const name = document.getElementById('setupName').value.trim();
    if(!name){ showToast('Enter your name to continue.'); return; }
    const profile = {
      id: uid(), name,
      company: document.getElementById('setupCompany').value.trim(),
      trade: document.getElementById('setupTrade').value,
      phone: document.getElementById('setupPhone').value.trim()
    };
    const btn = document.getElementById('setupSubmit');
    btn.disabled = true; btn.textContent = 'Saving…';
    try{
      await createSubcontractor(profile);
      saveProfile(profile);
      await renderHome();
    }catch(e){
      console.error(e);
      showToast("Couldn't save — check your connection and try again.");
      btn.disabled = false; btn.textContent = 'Continue';
    }
  };
}

/* ---------- home ---------- */
async function renderHome(){
  const profile = getProfile();
  setHeader(`Welcome back, ${profile.name.split(' ')[0]}`);
  app.innerHTML = `
    <div class="card">
      <div class="row">
        <div>
          <div style="font-weight:700; font-size:16px;">${escapeHtml(profile.name)}</div>
          <div class="item-meta">${escapeHtml([profile.company, profile.trade].filter(Boolean).join(' · ') || 'No company/trade on file')}</div>
        </div>
      </div>
      <div class="helptext" style="margin-top:8px;"><a href="#" id="switchProfileLink">Not you? Switch profile</a></div>
    </div>

    <div class="section-title">Site Status</div>
    <div class="card" id="statusCard"><div class="helptext">Checking status…</div></div>

    <div class="section-title">Submit a Form</div>
    <div class="card">
      <button class="btn ghost stack" data-doctype="hazard_assessment">Hazard Assessment</button>
      <button class="btn ghost stack" data-doctype="equipment_cert">Equipment Operation Certificate</button>
      <button class="btn ghost stack" data-doctype="incident_report">Incident Report</button>
    </div>
    <div class="helptext" style="margin:0 4px 4px;">Scan or take a photo of the completed form — it's uploaded straight from your phone.</div>

    <div class="section-title">Recent Activity</div>
    <div class="card" id="recentActivity"><div class="helptext">Loading…</div></div>
  `;

  document.getElementById('switchProfileLink').onclick = (e)=>{
    e.preventDefault();
    showConfirm('Switch to a different profile on this phone? Your saved info here will be cleared.', ()=>{
      clearProfile();
      renderSetup();
    });
  };
  document.querySelectorAll('[data-doctype]').forEach(btn=>{
    btn.onclick = ()=>openSubmitModal(btn.dataset.doctype);
  });

  refreshStatus();
  refreshActivity();
}

let currentOpenVisit = null;

async function refreshStatus(){
  const profile = getProfile();
  const el = document.getElementById('statusCard');
  try{
    currentOpenVisit = await fetchOpenVisit(profile.id);
  }catch(e){
    console.error(e);
    el.innerHTML = `<div class="helptext">Couldn't check your status — check your connection.</div>
      <button class="btn stack" id="retryStatus">Retry</button>`;
    document.getElementById('retryStatus').onclick = refreshStatus;
    return;
  }
  if(currentOpenVisit){
    el.className = 'card status-in';
    const t = new Date(currentOpenVisit.sign_in_at).toLocaleTimeString('en-US',{hour:'numeric', minute:'2-digit'});
    el.innerHTML = `
      <div style="font-weight:700;">Signed in at ${t}</div>
      <button class="btn danger stack" id="signOutBtn">Sign Out</button>
    `;
    document.getElementById('signOutBtn').onclick = async ()=>{
      const btn = document.getElementById('signOutBtn');
      btn.disabled = true; btn.textContent = 'Signing out…';
      try{
        await signOut(currentOpenVisit.id);
        showToast('Signed out. Have a safe trip home.');
        await refreshStatus();
        refreshActivity();
      }catch(e){
        console.error(e);
        showToast("Couldn't sign out — check your connection and try again.");
        btn.disabled = false; btn.textContent = 'Sign Out';
      }
    };
  } else {
    el.className = 'card status-out';
    el.innerHTML = `
      <div style="font-weight:700;">Not signed in</div>
      <button class="btn stack" id="signInBtn">Sign In</button>
    `;
    document.getElementById('signInBtn').onclick = async ()=>{
      const btn = document.getElementById('signInBtn');
      btn.disabled = true; btn.textContent = 'Signing in…';
      try{
        await signIn(profile);
        showToast('Signed in. Have a safe day on site.');
        await refreshStatus();
        refreshActivity();
      }catch(e){
        console.error(e);
        showToast("Couldn't sign in — check your connection and try again.");
        btn.disabled = false; btn.textContent = 'Sign In';
      }
    };
  }
}

async function refreshActivity(){
  const profile = getProfile();
  const el = document.getElementById('recentActivity');
  let visits = [], docs = [];
  try{
    ({visits, docs} = await fetchRecentActivity(profile.id));
  }catch(e){
    console.error(e);
    el.innerHTML = `<div class="helptext">Couldn't load recent activity.</div>`;
    return;
  }
  const items = [
    ...visits.map(v=>({ ts: v.sign_in_at, label: 'Signed in' })),
    ...visits.filter(v=>v.sign_out_at).map(v=>({ ts: v.sign_out_at, label: 'Signed out' })),
    ...docs.map(d=>({ ts: d.uploaded_at, label: `Submitted: ${DOC_TYPES[d.type] || d.type}` }))
  ].sort((a,b)=> new Date(b.ts) - new Date(a.ts)).slice(0, 8);

  if(!items.length){ el.innerHTML = `<div class="empty">No activity yet on this site.</div>`; return; }
  el.innerHTML = items.map(it=>`
    <div class="activity-item">
      <div>${escapeHtml(it.label)}</div>
      <div class="when">${new Date(it.ts).toLocaleString('en-US',{month:'short', day:'numeric', hour:'numeric', minute:'2-digit'})}</div>
    </div>
  `).join('');
}

/* ---------- submit hazard assessment / cert / incident report ---------- */
function openSubmitModal(type){
  showModal(`
    <h2>${escapeHtml(DOC_TYPES[type])}</h2>
    <div class="helptext" style="margin-bottom:6px;">Take a photo or choose a scanned file of the completed form.</div>
    <input type="file" id="docFile" accept="image/*,application/pdf" capture="environment">
    <img id="docPreview" class="file-preview" style="display:none;">
    <label>Notes (optional)</label>
    <textarea id="docNotes" placeholder="Anything the site super should know"></textarea>
    <button class="btn" id="docSubmitBtn" style="width:100%; margin-top:14px;">Submit</button>
  `);
  const fileInput = document.getElementById('docFile');
  const preview = document.getElementById('docPreview');
  fileInput.onchange = ()=>{
    const file = fileInput.files[0];
    if(file && file.type.startsWith('image/')){
      preview.src = URL.createObjectURL(file);
      preview.style.display = 'block';
    } else {
      preview.style.display = 'none';
    }
  };
  document.getElementById('docSubmitBtn').onclick = async ()=>{
    const file = fileInput.files[0];
    if(!file){ showToast('Choose a photo or file first.'); return; }
    const profile = getProfile();
    const notes = document.getElementById('docNotes').value.trim();
    const btn = document.getElementById('docSubmitBtn');
    btn.disabled = true; btn.textContent = 'Uploading…';
    try{
      const fileUrl = await uploadDocFile(file);
      await submitDocument(profile, type, fileUrl, notes);
      closeModal();
      showToast(`${DOC_TYPES[type]} submitted.`);
      refreshActivity();
    }catch(e){
      console.error(e);
      showToast("Couldn't submit — check your connection and try again.");
      btn.disabled = false; btn.textContent = 'Submit';
    }
  };
}

/* ---------- init ---------- */
(async function init(){
  const profile = getProfile();
  if(profile) await renderHome();
  else renderSetup();
})();

if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js').catch(e=>console.error('SW registration failed', e));
  });
}
