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

/* Shared with js/admin-view.js (SITE_LABELS derived from this, same pattern
   as DOC_TYPES above) — add a site here and it shows up everywhere: the
   sign-in form, the submit-a-form modal, and the Admin tab's filter/CSV. */
const SITES = [
  { key: 'juniper', label: 'Juniper Townhomes' },
  { key: 'aurora', label: 'Aurora Townhomes' }
];
const SITE_LABELS = Object.fromEntries(SITES.map(s => [s.key, s.label]));
function siteRadioRow(name, selectedKey){
  return SITES.map(s => `<label class="radio-opt"><input type="radio" name="${name}" value="${s.key}" ${s.key === selectedKey ? 'checked' : ''}> ${escapeHtml(s.label)}</label>`).join('');
}

function setHeader(sub){
  document.getElementById('headerSub').textContent = sub;
}

const INSTALL_HINT_BLURB = "Next time you won't need to rescan the QR code.";

/* ---------- tabs ----------
   Same app/URL for everyone — a subcontractor sees this tab bar too, and
   can tap Admin, but renderAdminTab() (js/admin-view.js) just shows a real
   Supabase login they have no account for. The tab being visible isn't the
   access control; the login is. */
document.querySelectorAll('nav.tabs button').forEach(b=>{
  b.onclick = ()=>{
    document.querySelectorAll('nav.tabs button').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    if(b.dataset.tab === 'admin') renderAdminTab();
    else { const profile = getProfile(); if(profile) renderHome(); else renderSetup(); }
  };
});

/* ---------- setup (one-time profile) ---------- */
function renderSetup(){
  setHeader('Quick one-time setup');
  app.innerHTML = `
    ${installHintHtml('installHintDismissed', INSTALL_HINT_BLURB)}
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
      showToast(e.message || "Couldn't save — check your connection and try again.");
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
    ${installHintHtml('installHintDismissed', INSTALL_HINT_BLURB)}
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

    <div class="section-title">Safety Forms</div>
    <div class="card">
      <button class="btn ghost stack" data-safetyform="site_orientation">Site Safety Orientation</button>
    </div>
    <div class="helptext" style="margin:0 4px 4px;">Fill this out right on your phone — no paper, no photo needed.</div>

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
  document.querySelectorAll('[data-safetyform]').forEach(btn=>{
    btn.onclick = ()=>openSafetyForm(btn.dataset.safetyform, profile);
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
      <div id="signOutError" class="warning-box" style="display:none; margin-top:10px;"></div>
    `;
    document.getElementById('signOutBtn').onclick = async ()=>{
      setFormError('signOutError', null);
      const btn = document.getElementById('signOutBtn');
      btn.disabled = true; btn.textContent = 'Signing out…';
      try{
        await withRetry(()=>signOut(openVisit.id), {
          onRetry: (attempt, total)=>{ btn.textContent = `Signing out… (retry ${attempt - 1}/${total - 1})`; }
        });
        showToast('Signed out. Have a safe trip home.');
        refreshStatus();
        refreshActivity();
      }catch(e){
        console.error(e);
        const msg = e.message || "Couldn't sign out — check your connection and try again.";
        showToast(msg);
        setFormError('signOutError', `Not saved: ${msg} You're still shown as signed in above — tap Sign Out again once you have a signal.`);
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

    <label>Which site are you signing into? *</label>
    <div class="radio-row">${siteRadioRow('siSite', getLastSite())}</div>

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

    ${signatureBlockHtml('sig', 'Signature')}

    <div id="siFormError" class="warning-box" style="display:none; margin-top:16px;"></div>
    <button class="btn" id="siSubmitBtn" style="width:100%; margin-top:12px;">Complete Sign-In</button>
  `);

  const canvas = wireSignatureBlock('sig');
  document.querySelectorAll('input[name="siMuster"]').forEach(r=>{
    r.onchange = ()=>{ document.getElementById('siMusterWarning').style.display = 'none'; };
  });
  document.querySelectorAll('input[name="siFit"]').forEach(r=>{
    r.onchange = ()=>{ document.getElementById('siFitWarning').style.display = 'none'; };
  });

  document.getElementById('siSubmitBtn').onclick = ()=>submitSignInForm(profile, canvas);
}

/* ---------- reusable signature block (draw or type) ----------
   Used wherever something needs a signature: the Daily Sign-In form, the
   Site Safety Orientation form's worker signature, and the Admin tab's
   countersign flow (js/admin-view.js). `id` prefixes every element so
   more than one independent signature pad can exist in the same modal —
   e.g. worker signs one, a site safety rep signs a separate one later. */
function signatureBlockHtml(id, label){
  return `
    <label>${escapeHtml(label)} *</label>
    <div class="sig-toggle"><a href="#" id="${id}ToggleType">Type instead</a></div>
    <div id="${id}DrawWrap">
      <canvas id="${id}Canvas" class="sig-canvas"></canvas>
      <button class="btn ghost small" id="${id}ClearBtn" style="margin-top:6px;">Clear</button>
    </div>
    <div id="${id}TypeWrap" style="display:none;">
      <input id="${id}TypedInput" type="text" placeholder="Type your full name" class="sig-typed-input">
      <div class="sig-toggle"><a href="#" id="${id}ToggleDraw">Draw instead</a></div>
    </div>
  `;
}
function wireSignatureBlock(id){
  const canvas = setupSignatureCanvas(`${id}Canvas`);
  document.getElementById(`${id}ClearBtn`).onclick = ()=>canvas.clearSig();
  document.getElementById(`${id}ToggleType`).onclick = (e)=>{
    e.preventDefault();
    document.getElementById(`${id}DrawWrap`).style.display = 'none';
    document.getElementById(`${id}TypeWrap`).style.display = 'block';
    document.getElementById(`${id}TypedInput`).focus();
  };
  document.getElementById(`${id}ToggleDraw`).onclick = (e)=>{
    e.preventDefault();
    document.getElementById(`${id}TypeWrap`).style.display = 'none';
    document.getElementById(`${id}DrawWrap`).style.display = 'block';
  };
  return canvas;
}
/* Reads back whichever mode (draw/type) is active for a block built by
   signatureBlockHtml/wireSignatureBlock above. { signed: false } if
   nothing's actually been signed yet in either mode. */
function readSignatureBlock(id, canvas){
  const typing = document.getElementById(`${id}TypeWrap`).style.display !== 'none';
  if(typing){
    const text = document.getElementById(`${id}TypedInput`).value.trim();
    return text ? { signed: true, type: 'typed', text } : { signed: false };
  }
  return canvas.hasStrokes() ? { signed: true, type: 'drawn', canvas } : { signed: false };
}

/* Pointer-event canvas signature pad — works with touch, mouse, and stylus. */
function setupSignatureCanvas(canvasId = 'sigCanvas'){
  const canvas = document.getElementById(canvasId);
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

/* Turns a readSignatureBlock() result into the {signatureType,
   signatureText, signatureFileUrl} shape every signing write stores —
   uploads the drawn-signature blob if that's the mode in use. Shared by
   the Daily Sign-In form and the Site Safety Orientation form. */
async function uploadSignatureFields(sig){
  if(sig.type === 'typed') return { signatureType: 'typed', signatureText: sig.text, signatureFileUrl: null };
  const blob = await new Promise(resolve=>sig.canvas.toBlob(resolve, 'image/png'));
  const signatureFileUrl = await uploadSignatureBlob(blob);
  return { signatureType: 'drawn', signatureText: null, signatureFileUrl };
}

async function submitSignInForm(profile, canvas){
  setFormError('siFormError', null);
  const site = document.querySelector('input[name="siSite"]:checked');
  const crewCount = document.getElementById('siCrewCount').value.trim();
  const crewNames = document.getElementById('siCrewNames').value.trim();
  const orientation = document.querySelector('input[name="siOrientation"]:checked');
  const muster = document.querySelector('input[name="siMuster"]:checked');
  const fit = document.querySelector('input[name="siFit"]:checked');
  const sig = readSignatureBlock('sig', canvas);

  if(!site){ showToast('Select which site you\'re signing into.'); return; }
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
  if(!sig.signed){ showToast('Sign in the box, or tap "Type instead."'); return; }

  const btn = document.getElementById('siSubmitBtn');
  btn.disabled = true; btn.textContent = 'Signing in…';
  try{
    const { signatureType, signatureText, signatureFileUrl } = await uploadSignatureFields(sig);
    await signIn(profile, {
      site: site.value, siteLabel: SITE_LABELS[site.value],
      crewCount: Number(crewCount), crewNames,
      hadOrientation: orientation.value === 'yes',
      musterPoint: muster.value,
      fitForWork: fit.value === 'yes',
      signatureType, signatureText, signatureFileUrl
    });
    setLastSite(site.value);
    closeModal();
    showToast('Signed in. Have a safe day on site.');
    refreshStatus();
    refreshActivity();
  }catch(e){
    console.error(e);
    const msg = e.message || "Couldn't sign in — check your connection and try again.";
    showToast(msg);
    setFormError('siFormError', `Not saved: ${msg}`);
    setModalCloseGuard("This sign-in hasn't been saved yet. Are you sure you want to close without finishing?");
    btn.disabled = false; btn.textContent = 'Complete Sign-In';
  }
}

/* ---------- submit hazard assessment / cert / incident report ---------- */
function openSubmitModal(type){
  showModal(`
    <h2>${escapeHtml(DOC_TYPES[type])}</h2>
    <div class="helptext" style="margin-bottom:6px;">Take a photo or choose a scanned file of the completed form.</div>
    <label>Which site is this for? *</label>
    <div class="radio-row">${siteRadioRow('docSite', getLastSite())}</div>
    <input type="file" id="docFile" accept="image/*,application/pdf" capture="environment">
    <img id="docPreview" class="file-preview" style="display:none;">
    <label>Notes (optional)</label>
    <textarea id="docNotes" placeholder="Anything the site super should know"></textarea>
    <div id="docFormError" class="warning-box" style="display:none; margin-top:14px;"></div>
    <button class="btn" id="docSubmitBtn" style="width:100%; margin-top:12px;">Submit</button>
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
    setFormError('docFormError', null);
    const site = document.querySelector('input[name="docSite"]:checked');
    const file = fileInput.files[0];
    if(!site){ showToast('Select which site this is for.'); return; }
    if(!file){ showToast('Choose a photo or file first.'); return; }
    const profile = getProfile();
    const notes = document.getElementById('docNotes').value.trim();
    const btn = document.getElementById('docSubmitBtn');
    btn.disabled = true; btn.textContent = 'Uploading…';
    try{
      const fileUrl = await uploadDocFile(file);
      await submitDocument(profile, type, fileUrl, notes, DOC_TYPES[type], site.value, SITE_LABELS[site.value]);
      setLastSite(site.value);
      closeModal();
      showToast(`${DOC_TYPES[type]} submitted.`);
      refreshActivity();
    }catch(e){
      console.error(e);
      const msg = e.message || "Couldn't submit — check your connection and try again.";
      showToast(msg);
      setFormError('docFormError', `Not saved: ${msg}`);
      setModalCloseGuard("This submission hasn't been saved yet. Are you sure you want to close without finishing?");
      btn.disabled = false; btn.textContent = 'Submit';
    }
  };
}

/* ---------- structured safety forms ----------
   Filled out entirely in-app rather than uploaded as a photo of a paper
   form (see "Submit a Form" above for that older flow). Site Safety
   Orientation is the first of these — Josh plans a Hazard Assessment and
   a Machine Pre-Trip Checklist the same way, so this is built as data
   (SAFETY_FORMS) plus one generic renderer/validator/submit flow rather
   than bespoke code per form. Adding the next one means adding a new key
   here, not new plumbing.

   Each form's worker side is self-contained and signed by the worker
   alone — a Site Safety Representative countersigns separately afterward
   from the Admin tab (js/admin-view.js), not in the same session, since
   the two don't always fill this out together in person. */
const SAFETY_FORMS = {
  site_orientation: {
    label: 'Site Safety Orientation',
    submitLabel: 'Complete Orientation',
    sections: [
      { title: 'Worker Information', fields: [
        { id: 'site', type: 'site', label: 'Project / Site', required: true },
        { id: 'workerName', type: 'text', label: 'Name', required: true, prefillFrom: 'name' },
        { id: 'company', type: 'text', label: 'Company', required: true, prefillFrom: 'company' },
        { id: 'position', type: 'text', label: 'Position', required: true, prefillFrom: 'trade' },
        { id: 'phone', type: 'text', label: 'Phone', required: true, prefillFrom: 'phone' },
        { id: 'emergencyContact', type: 'text', label: 'Emergency Contact Name', required: true },
        { id: 'emergencyContactPhone', type: 'text', label: 'Emergency Contact Phone', required: true },
        { id: 'emergencyContactRelation', type: 'text', label: 'Relation to Contact', required: true }
      ] },
      { title: 'Minimum Safety Requirements', fields: [
        { id: 'q1_newYoungWorker', type: 'yesno', label: 'Are you a New/Young worker as defined by WorkSafe (under 25 years old, new to the company, or new to a task)?', required: true },
        { id: 'q1a_orientationGiven', type: 'yesno', label: 'If yes: has your employer given you a safety orientation/training, and do you have a clear understanding of your duties on site?', required: true, showIf: { field: 'q1_newYoungWorker', equals: 'yes' }, blockIfNo: true },
        { id: 'q2_hazardsAware', type: 'yesno', label: 'Are you aware of hazards associated with your work, and has your employer provided you with the tools to safely complete it?', required: true, blockIfNo: true },
        { id: 'q2_hazardsWhat', type: 'textarea', label: 'What are they?', required: true },
        { id: 'q3_fallProtectionRequired', type: 'yesno', label: 'Does your scope of work require you to use fall protection?', required: true },
        { id: 'q3a_fallProtectionCertified', type: 'yesno', label: 'If yes: has your employer provided you with the necessary certification and equipment?', required: true, showIf: { field: 'q3_fallProtectionRequired', equals: 'yes' }, blockIfNo: true }
      ], blockNote: 'If "No" to any of the above, your employer must address it before you begin work associated with it.' },
      { title: 'Safe Work Practices', fields: [
        { id: 'ack_ladders', type: 'ack', label: "Ladders (grade 1, legible manufacturer's labels, and inspected for cracked or broken rungs)", required: true },
        { id: 'ack_repetitiveTasks', type: 'ack', label: 'Watch for signs and symptoms from repetitive tasks (numbness, tingling, redness or swelling) and report them to your supervisor', required: true },
        { id: 'ack_dangerCautionTape', type: 'ack', label: 'Danger and Caution taped areas on site', required: true },
        { id: 'ack_mobileEquipment', type: 'ack', label: 'Mobile equipment (PPE and eye contact)', required: true },
        { id: 'ack_housekeeping', type: 'ack', label: 'Housekeeping/cleanup requirements of your work area — failure to do so may be followed by a fine', required: true },
        { id: 'ack_courtesy', type: 'ack', label: 'Courtesy to the general public', required: true },
        { id: 'firstAid_has', type: 'yesno', label: 'Do you have a current first aid certificate?', required: true },
        { id: 'firstAid_level', type: 'radio', label: 'Level', required: true, showIf: { field: 'firstAid_has', equals: 'yes' }, options: [{ value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' }] },
        { id: 'whmis_has', type: 'yesno', label: 'Do you have WHMIS training?', required: true }
      ] },
      { title: 'Safety Absolutes', fields: [
        { id: 'ack_zeroToleranceDrugs', type: 'ack', label: 'Drugs/alcohol/smoking on site = ZERO TOLERANCE', required: true },
        { id: 'ack_zeroToleranceViolence', type: 'ack', label: 'Violence in the workplace, bullying and harassment = ZERO TOLERANCE', required: true }
      ] },
      { title: 'General Safety Requirements', fields: [
        { id: 'ack_adherePolicy', type: 'ack', label: 'Adhere to the Slokker Homes Safety Program and Policies and comply with all WorkSafe regulations', required: true },
        { id: 'ack_rightToRefuse', type: 'ack', label: 'You have the right to refuse unsafe work', required: true },
        { id: 'ack_correctHazards', type: 'ack', label: 'Responsibility to correct safety hazards', required: true },
        { id: 'ack_reportUnsafe', type: 'ack', label: 'Reporting unsafe acts and conditions', required: true },
        { id: 'ack_reportInjuries', type: 'ack', label: 'Reporting accidents/injuries', required: true },
        { id: 'ack_ppe', type: 'ack', label: 'Personal Protective Equipment (PPE)', required: true },
        { id: 'ack_clothing', type: 'ack', label: 'Proper clothing required', required: true },
        { id: 'ack_toolboxTalks', type: 'ack', label: 'Attend all toolbox talks', required: true },
        { id: 'ack_accessRoutes', type: 'ack', label: 'Access routes to remain clear', required: true },
        { id: 'ack_radios', type: 'ack', label: 'Radios permitted @ low volume, NO EAR BUDS', required: true },
        { id: 'ack_noSmoking', type: 'ack', label: 'No smoking or vaping except in designated area', required: true }
      ] },
      { title: 'Slokker Homes Safety Policy', fields: [
        { id: 'policy_disciplinaryExplained', type: 'yesno', label: 'Has the Slokker Homes disciplinary policy been explained?', required: true },
        { id: 'policy_disciplinaryUnderstood', type: 'yesno', label: 'Do you understand and accept the Slokker Homes disciplinary policy regarding safety absolutes?', required: true },
        { id: 'policy_siteRulesAgree', type: 'yesno', label: 'Do you understand and agree to abide by the general site rules?', required: true }
      ] },
      { title: 'Emergency Procedures', fields: [
        { id: 'ack_jobSiteMap', type: 'ack', label: 'Job site map and Safety Board — reviewed', required: true },
        { id: 'ack_musterLocation', type: 'ack', label: 'Job site Muster Location(s) — reviewed', required: true },
        { id: 'ack_emergencyProcedures', type: 'ack', label: 'Job site emergency procedures reviewed: 3 blasts = First Aid, 2 blasts = Fire, 1 blast = Evacuation', required: true }
      ] },
      { title: 'Allergies / Medication or Conditions', fields: [
        { id: 'allergiesNotes', type: 'textarea', label: 'Anything we should know about? Write "None" if not applicable', required: true }
      ] }
    ],
    acknowledgment: 'I have read, understand, and will comply with the Slokker Homes Safety Program & Procedures, the details of this orientation, current Occupational Health & Safety (OH&S) Regulation and site directives.'
  }
};

function sfFieldName(id){ return `sf_${id}`; }

function renderSafetyField(field, profile){
  const name = sfFieldName(field.id);
  const wrapAttrs = field.showIf ? ` data-show-if-field="${sfFieldName(field.showIf.field)}" data-show-if-equals="${escapeHtml(field.showIf.equals)}" style="display:none;"` : '';
  let inner;
  if(field.type === 'site'){
    inner = `<label>${escapeHtml(field.label)}${field.required ? ' *' : ''}</label><div class="radio-row">${siteRadioRow(name, getLastSite())}</div>`;
  } else if(field.type === 'text'){
    const prefill = field.prefillFrom && profile ? (profile[field.prefillFrom] || '') : '';
    inner = `<label>${escapeHtml(field.label)}${field.required ? ' *' : ''}</label><input type="text" id="${name}" value="${escapeHtml(prefill)}">`;
  } else if(field.type === 'textarea'){
    inner = `<label>${escapeHtml(field.label)}${field.required ? ' *' : ''}</label><textarea id="${name}"></textarea>`;
  } else if(field.type === 'yesno'){
    inner = `<label>${escapeHtml(field.label)}${field.required ? ' *' : ''}</label>
      <div class="radio-row">
        <label class="radio-opt"><input type="radio" name="${name}" value="yes"> Yes</label>
        <label class="radio-opt"><input type="radio" name="${name}" value="no"> No</label>
      </div>`;
  } else if(field.type === 'radio'){
    inner = `<label>${escapeHtml(field.label)}${field.required ? ' *' : ''}</label>
      <div class="radio-row">${field.options.map(o=>`<label class="radio-opt"><input type="radio" name="${name}" value="${escapeHtml(o.value)}"> ${escapeHtml(o.label)}</label>`).join('')}</div>`;
  } else if(field.type === 'ack'){
    inner = `<label class="radio-opt" style="margin-top:10px;"><input type="checkbox" id="${name}"> ${escapeHtml(field.label)}</label>`;
  }
  return `<div class="sf-field" data-field="${name}"${wrapAttrs}>${inner}</div>`;
}

function renderSafetyForm(formType, profile){
  const schema = SAFETY_FORMS[formType];
  const sectionsHtml = schema.sections.map(section => `
    <div class="section-title" style="margin:20px 4px 6px;">${escapeHtml(section.title)}</div>
    ${section.fields.map(f=>renderSafetyField(f, profile)).join('')}
    ${section.blockNote ? `<div class="helptext" style="margin:6px 4px 0;">${escapeHtml(section.blockNote)}</div>` : ''}
  `).join('');
  return `
    <h2>${escapeHtml(schema.label)}</h2>
    ${sectionsHtml}
    <div class="divider"></div>
    <div class="helptext" style="font-style:italic;">${escapeHtml(schema.acknowledgment)}</div>
    ${signatureBlockHtml('sfSig', 'Your Signature')}
    <div id="sfBlockWarning" class="warning-box" style="display:none;"></div>
    <div id="sfFormError" class="warning-box" style="display:none; margin-top:16px;"></div>
    <button class="btn" id="sfSubmitBtn" style="width:100%; margin-top:12px;">${escapeHtml(schema.submitLabel)}</button>
  `;
}

/* Shows/hides every conditional (showIf) field against the form's current
   answers — called once after render and again on every change so a
   dependent field (e.g. 1A, only relevant if Q1 is "Yes") appears or
   disappears live rather than needing a second pass. */
function updateSafetyFormConditionals(){
  document.querySelectorAll('.sf-field[data-show-if-field]').forEach(el=>{
    const controllingField = el.dataset.showIfField;
    const checked = document.querySelector(`input[name="${controllingField}"]:checked`);
    const show = checked && checked.value === el.dataset.showIfEquals;
    el.style.display = show ? 'block' : 'none';
  });
}

/* Walks the schema, reading each visible field's current value. Returns
   { valid, site, answers, blockedLabels } — answers is a flat
   {fieldId: value} object (independent of showIf — a hidden/inapplicable
   field is simply left out) ready to store as-is in the safety_forms
   table's answers jsonb column. A 'site' field is pulled out separately
   rather than folded into answers, matching site_visits/safety_documents
   storing it as its own column (so the Admin tab's existing site filter/
   CSV column work on this form too, same as everywhere else). blockedLabels
   lists any "must be resolved before work starts" question answered "No"
   (see SAFETY_FORMS' blockIfNo) — present but the caller decides whether
   that blocks submission or just warns. */
function collectSafetyForm(formType){
  const schema = SAFETY_FORMS[formType];
  const answers = {};
  let site = null;
  let firstMissingLabel = null;
  const blockedLabels = [];
  schema.sections.forEach(section=>{
    section.fields.forEach(field=>{
      const name = sfFieldName(field.id);
      const el = document.querySelector(`[data-field="${name}"]`);
      const visible = !el || el.style.display !== 'none';
      if(!visible) return;
      let value = null;
      if(field.type === 'site'){
        const checked = document.querySelector(`input[name="${name}"]:checked`);
        value = checked ? checked.value : null;
        if(field.required && !value){ if(!firstMissingLabel) firstMissingLabel = field.label; return; }
        site = value;
        return;
      }
      if(field.type === 'text' || field.type === 'textarea'){
        value = document.getElementById(name).value.trim();
      } else if(field.type === 'yesno' || field.type === 'radio'){
        const checked = document.querySelector(`input[name="${name}"]:checked`);
        value = checked ? checked.value : null;
      } else if(field.type === 'ack'){
        value = document.getElementById(name).checked ? true : null;
      }
      if(field.required && (value === null || value === '')){
        if(!firstMissingLabel) firstMissingLabel = field.label;
        return;
      }
      if(value !== null && value !== '') answers[field.id] = value;
      if(field.blockIfNo && value === 'no') blockedLabels.push(field.label);
    });
  });
  return { valid: !firstMissingLabel, firstMissingLabel, site, answers, blockedLabels };
}

function openSafetyForm(formType, profile){
  const schema = SAFETY_FORMS[formType];
  showModal(renderSafetyForm(formType, profile));
  const canvas = wireSignatureBlock('sfSig');
  updateSafetyFormConditionals();
  document.querySelectorAll('.sf-field input[type="radio"]').forEach(r=>{
    r.onchange = updateSafetyFormConditionals;
  });

  document.getElementById('sfSubmitBtn').onclick = async ()=>{
    setFormError('sfFormError', null);
    document.getElementById('sfBlockWarning').style.display = 'none';
    const { valid, firstMissingLabel, site, answers, blockedLabels } = collectSafetyForm(formType);
    if(!valid){ showToast(`Answer: ${firstMissingLabel}`); return; }
    if(blockedLabels.length){
      document.getElementById('sfBlockWarning').textContent =
        `You can't submit with "No" to: ${blockedLabels.join('; ')}. Please speak with your site supervisor before continuing — they need to address this first.`;
      document.getElementById('sfBlockWarning').style.display = 'block';
      return;
    }
    const sig = readSignatureBlock('sfSig', canvas);
    if(!sig.signed){ showToast('Sign in the box, or tap "Type instead."'); return; }

    const btn = document.getElementById('sfSubmitBtn');
    btn.disabled = true; btn.textContent = 'Submitting…';
    try{
      const { signatureType, signatureText, signatureFileUrl } = await uploadSignatureFields(sig);
      await submitSafetyForm(profile, formType, site, answers, signatureType, signatureText, signatureFileUrl);
      setLastSite(site);
      closeModal();
      showToast(`${schema.label} submitted.`);
      refreshActivity();
    }catch(e){
      console.error(e);
      const msg = e.message || "Couldn't submit — check your connection and try again.";
      showToast(msg);
      setFormError('sfFormError', `Not saved: ${msg}`);
      setModalCloseGuard("This form hasn't been saved yet. Are you sure you want to close without finishing?");
      btn.disabled = false; btn.textContent = schema.submitLabel;
    }
  };
}

/* ---------- init ----------
   Not auto-invoked here — called from index.html after js/admin-view.js
   has also loaded, since an invite/reset link (parseAuthCallbackHash,
   renderSetPasswordForm — both in js/admin-view.js) needs to be checked
   before deciding whether to show the normal Sign In flow. */
async function initApp(){
  const callback = parseAuthCallbackHash();
  if(callback){
    document.querySelectorAll('nav.tabs button').forEach(x=>x.classList.remove('active'));
    document.querySelector('nav.tabs button[data-tab="admin"]').classList.add('active');
    renderSetPasswordForm(callback);
    return;
  }
  const profile = getProfile();
  if(profile) await renderHome();
  else renderSetup();
}

if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js').catch(e=>console.error('SW registration failed', e));
  });
}
