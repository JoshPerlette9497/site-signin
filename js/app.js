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
const CORRECT_MUSTER_POINT = '81st_street';

function setHeader(sub){
  document.getElementById('headerSub').textContent = sub;
}

/* ---------- add-to-home-screen hint ---------- */
function isStandalone(){
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}
function isIOS(){
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}
function installHintHtml(){
  if(isStandalone() || localStorage.getItem('installHintDismissed')) return '';
  const steps = isIOS()
    ? 'Tap the <strong>Share</strong> icon, then <strong>Add to Home Screen</strong>.'
    : 'Tap the <strong>⋮</strong> menu, then <strong>Add to Home screen</strong> (or <strong>Install app</strong>).';
  return `
    <div class="card install-hint" id="installHint">
      <div class="row">
        <div>
          <div style="font-weight:700;">Add this to your Home Screen</div>
          <div class="item-meta">${steps} Next time you won't need to rescan the QR code.</div>
        </div>
        <button class="btn ghost small" id="installHintDismiss">×</button>
      </div>
    </div>
  `;
}
function wireInstallHint(){
  const dismiss = document.getElementById('installHintDismiss');
  if(dismiss) dismiss.onclick = ()=>{
    localStorage.setItem('installHintDismissed', '1');
    document.getElementById('installHint').remove();
  };
}

/* ---------- setup (one-time profile) ---------- */
function renderSetup(){
  setHeader('Quick one-time setup');
  app.innerHTML = `
    ${installHintHtml()}
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
  wireInstallHint();
}

/* ---------- home ---------- */
async function renderHome(){
  const profile = getProfile();
  setHeader(`Welcome back, ${profile.name.split(' ')[0]}`);
  app.innerHTML = `
    ${installHintHtml()}
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
      clearCurrentVisit();
      localStorage.removeItem('subActivityLog');
      renderSetup();
    });
  };
  document.querySelectorAll('[data-doctype]').forEach(btn=>{
    btn.onclick = ()=>openSubmitModal(btn.dataset.doctype);
  });
  wireInstallHint();

  refreshStatus();
  refreshActivity();
}

/* Status and activity are tracked locally on the phone (see js/storage.js)
   rather than read back from Supabase — reads now require an authenticated
   (admin) session, which the subcontractor app intentionally never has. */
function refreshStatus(){
  const profile = getProfile();
  const el = document.getElementById('statusCard');
  const openVisit = getCurrentVisit();
  if(openVisit){
    el.className = 'card status-in';
    const t = new Date(openVisit.sign_in_at).toLocaleTimeString('en-US',{hour:'numeric', minute:'2-digit'});
    el.innerHTML = `
      <div style="font-weight:700;">Signed in at ${t}</div>
      <button class="btn danger stack" id="signOutBtn">Sign Out</button>
    `;
    document.getElementById('signOutBtn').onclick = async ()=>{
      const btn = document.getElementById('signOutBtn');
      btn.disabled = true; btn.textContent = 'Signing out…';
      try{
        await signOut(openVisit.id);
        showToast('Signed out. Have a safe trip home.');
        refreshStatus();
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
    document.getElementById('signInBtn').onclick = ()=>openSignInForm(profile);
  }
}

function refreshActivity(){
  const el = document.getElementById('recentActivity');
  const items = getActivityLog().slice(0, 8);
  if(!items.length){ el.innerHTML = `<div class="empty">No activity yet on this site.</div>`; return; }
  el.innerHTML = items.map(it=>`
    <div class="activity-item">
      <div>${escapeHtml(it.label)}</div>
      <div class="when">${new Date(it.ts).toLocaleString('en-US',{month:'short', day:'numeric', hour:'numeric', minute:'2-digit'})}</div>
    </div>
  `).join('');
}

/* ---------- daily sign-in form ---------- */
function openSignInForm(profile){
  showModal(`
    <h2>Daily Sign-In</h2>
    <div class="helptext" style="margin-bottom:6px;">Complete this each time you sign in for the day.</div>

    <label>How many workers are on your crew today? *</label>
    <input id="siCrewCount" type="number" min="1" inputmode="numeric" placeholder="e.g. 4">

    <label>First and last names of all crew members *</label>
    <textarea id="siCrewNames" placeholder="One name per line"></textarea>

    <label>Have I received orientation on this site? *</label>
    <div class="radio-row">
      <label class="radio-opt"><input type="radio" name="siOrientation" value="yes"> Yes</label>
      <label class="radio-opt"><input type="radio" name="siOrientation" value="no"> No</label>
    </div>

    <label>Where is the muster point located? *</label>
    <div class="radio-row">
      <label class="radio-opt"><input type="radio" name="siMuster" value="site_office"> Site Office</label>
      <label class="radio-opt"><input type="radio" name="siMuster" value="81st_street"> 81st Street SW</label>
    </div>
    <div id="siMusterWarning" class="warning-box" style="display:none;">
      That's not correct. The muster point is <strong>81st Street SW</strong>. Please complete a site orientation with your supervisor before signing in.
    </div>

    <label>I acknowledge that I am "fit for work" on arrival to site and will comply with all site rules as laid out by the General Contractor *</label>
    <div class="radio-row">
      <label class="radio-opt"><input type="radio" name="siFit" value="yes"> Yes</label>
      <label class="radio-opt"><input type="radio" name="siFit" value="no"> No</label>
    </div>
    <div id="siFitWarning" class="warning-box" style="display:none;">
      You can't sign in without confirming this. If you're not fit for work today, please speak with your site supervisor before entering the site.
    </div>

    <label>Signature *</label>
    <div class="sig-toggle"><a href="#" id="sigToggleType">Type instead</a></div>
    <div id="sigDrawWrap">
      <canvas id="sigCanvas" class="sig-canvas"></canvas>
      <button class="btn ghost small" id="sigClearBtn" style="margin-top:6px;">Clear</button>
    </div>
    <div id="sigTypeWrap" style="display:none;">
      <input id="sigTypedInput" type="text" placeholder="Type your full name" class="sig-typed-input">
      <div class="sig-toggle"><a href="#" id="sigToggleDraw">Draw instead</a></div>
    </div>

    <button class="btn" id="siSubmitBtn" style="width:100%; margin-top:16px;">Complete Sign-In</button>
  `);

  const canvas = setupSignatureCanvas();
  document.getElementById('sigClearBtn').onclick = ()=>canvas.clearSig();
  document.getElementById('sigToggleType').onclick = (e)=>{
    e.preventDefault();
    document.getElementById('sigDrawWrap').style.display = 'none';
    document.getElementById('sigTypeWrap').style.display = 'block';
    document.getElementById('sigTypedInput').focus();
  };
  document.getElementById('sigToggleDraw').onclick = (e)=>{
    e.preventDefault();
    document.getElementById('sigTypeWrap').style.display = 'none';
    document.getElementById('sigDrawWrap').style.display = 'block';
  };
  document.querySelectorAll('input[name="siMuster"]').forEach(r=>{
    r.onchange = ()=>{ document.getElementById('siMusterWarning').style.display = 'none'; };
  });
  document.querySelectorAll('input[name="siFit"]').forEach(r=>{
    r.onchange = ()=>{ document.getElementById('siFitWarning').style.display = 'none'; };
  });

  document.getElementById('siSubmitBtn').onclick = ()=>submitSignInForm(profile, canvas);
}

/* Pointer-event canvas signature pad — works with touch, mouse, and stylus. */
function setupSignatureCanvas(){
  const canvas = document.getElementById('sigCanvas');
  const ctx = canvas.getContext('2d');
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * ratio;
  canvas.height = rect.height * ratio;
  ctx.scale(ratio, ratio);
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#1B2B2C';

  let drawing = false, hasStrokes = false, lastX = 0, lastY = 0;
  const pos = (e)=>{
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  canvas.addEventListener('pointerdown', (e)=>{
    drawing = true; hasStrokes = true;
    const p = pos(e); lastX = p.x; lastY = p.y;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e)=>{
    if(!drawing) return;
    const p = pos(e);
    ctx.beginPath(); ctx.moveTo(lastX, lastY); ctx.lineTo(p.x, p.y); ctx.stroke();
    lastX = p.x; lastY = p.y;
  });
  const stop = ()=>{ drawing = false; };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointerleave', stop);
  canvas.hasStrokes = ()=>hasStrokes;
  canvas.clearSig = ()=>{ ctx.clearRect(0, 0, canvas.width, canvas.height); hasStrokes = false; };
  return canvas;
}

async function submitSignInForm(profile, canvas){
  const crewCount = document.getElementById('siCrewCount').value.trim();
  const crewNames = document.getElementById('siCrewNames').value.trim();
  const orientation = document.querySelector('input[name="siOrientation"]:checked');
  const muster = document.querySelector('input[name="siMuster"]:checked');
  const fit = document.querySelector('input[name="siFit"]:checked');
  const typing = document.getElementById('sigTypeWrap').style.display !== 'none';
  const typedSig = document.getElementById('sigTypedInput').value.trim();

  if(!crewCount || Number(crewCount) < 1){ showToast('Enter how many workers are on your crew today.'); return; }
  if(!crewNames){ showToast('Enter the names of all crew members.'); return; }
  if(!orientation){ showToast("Answer whether you've received orientation on this site."); return; }
  if(!muster){ showToast('Select where the muster point is located.'); return; }
  if(muster.value !== CORRECT_MUSTER_POINT){
    document.getElementById('siMusterWarning').style.display = 'block';
    return;
  }
  if(!fit){ showToast('Answer the fit-for-work acknowledgment.'); return; }
  if(fit.value !== 'yes'){
    document.getElementById('siFitWarning').style.display = 'block';
    return;
  }
  if(!typing && !canvas.hasStrokes()){ showToast('Sign in the box, or tap "Type instead."'); return; }
  if(typing && !typedSig){ showToast('Type your name to sign.'); return; }

  const btn = document.getElementById('siSubmitBtn');
  btn.disabled = true; btn.textContent = 'Signing in…';
  try{
    let signatureType, signatureText = null, signatureFileUrl = null;
    if(typing){
      signatureType = 'typed'; signatureText = typedSig;
    } else {
      signatureType = 'drawn';
      const blob = await new Promise(resolve=>canvas.toBlob(resolve, 'image/png'));
      signatureFileUrl = await uploadSignatureBlob(blob);
    }
    await signIn(profile, {
      crewCount: Number(crewCount), crewNames,
      hadOrientation: orientation.value === 'yes',
      musterPoint: muster.value,
      fitForWork: fit.value === 'yes',
      signatureType, signatureText, signatureFileUrl
    });
    closeModal();
    showToast('Signed in. Have a safe day on site.');
    refreshStatus();
    refreshActivity();
  }catch(e){
    console.error(e);
    showToast("Couldn't sign in — check your connection and try again.");
    btn.disabled = false; btn.textContent = 'Complete Sign-In';
  }
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
      await submitDocument(profile, type, fileUrl, notes, DOC_TYPES[type]);
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
