/* ---------- modal ---------- */
function showModal(html){
  closeModal();
  const bg = document.createElement('div');
  bg.className='modal-bg'; bg.id='modalBg';
  bg.innerHTML = `<div class="modal" style="position:relative;"><button class="close" id="modalClose">×</button>${html}</div>`;
  document.body.appendChild(bg);
  document.getElementById('modalClose').onclick = closeModal;
  bg.onclick = (e)=>{ if(e.target===bg) closeModal(); };
}
function closeModal(){ const bg=document.getElementById('modalBg'); if(bg) bg.remove(); }

/* Makes the × and outside-tap close require an explicit confirmation —
   used after a save fails, so a trade in a hurry can't dismiss a failed
   sign-in/submission by tapping past a toast that's already faded. Each
   showModal() call rebuilds #modalClose/#modalBg from scratch, so this
   guard never carries over into the next modal that's opened. */
function setModalCloseGuard(msg){
  const closeBtn = document.getElementById('modalClose');
  const bg = document.getElementById('modalBg');
  if(!closeBtn || !bg) return;
  closeBtn.onclick = ()=>{ if(confirm(msg)) closeModal(); };
  bg.onclick = (e)=>{ if(e.target===bg && confirm(msg)) closeModal(); };
}

/* Persistent (non-auto-dismissing) error banner inside the modal, for the
   same reason as the guard above — a toast fades in a few seconds and can
   be missed entirely; this stays until the next submit attempt either
   clears it or replaces it. `elId` is a placeholder div already in the
   form's HTML (e.g. right above its submit button). */
function setFormError(elId, msg){
  const el = document.getElementById(elId);
  if(!el) return;
  if(!msg){ el.style.display = 'none'; el.textContent = ''; return; }
  el.textContent = msg;
  el.style.display = 'block';
}

function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function showToast(msg){
  const t = document.createElement('div');
  t.style.cssText = 'position:fixed; bottom:24px; left:16px; right:16px; z-index:100; background:var(--brand-dark); color:#fff; padding:12px 16px; border-radius:10px; font-size:13px; font-weight:600; box-shadow:0 4px 16px rgba(0,0,0,0.25); text-align:center;';
  t.textContent = msg;
  document.body.appendChild(t);
  const duration = Math.min(12000, Math.max(3500, msg.length * 90));
  setTimeout(()=>t.remove(), duration);
}
function showConfirm(msg, onYes){
  showModal(`
    <h2>Confirm</h2>
    <div class="helptext" style="margin-bottom:14px;">${escapeHtml(msg)}</div>
    <div class="row" style="gap:8px;">
      <button class="btn ghost" id="confirmNo" style="flex:1;">Cancel</button>
      <button class="btn danger" id="confirmYes" style="flex:1;">Confirm</button>
    </div>
  `);
  document.getElementById('confirmNo').onclick = closeModal;
  document.getElementById('confirmYes').onclick = ()=>{ closeModal(); onYes(); };
}

/* ---------- add-to-home-screen hint ----------
   Shared by index.html (subcontractor app) and admin.html (Josh's
   dashboard) — each installs as its own separate home-screen icon, so each
   page passes its own dismissKey and blurb. */
function isStandalone(){
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}
function isIOS(){
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}
function installHintHtml(dismissKey, blurb){
  if(isStandalone() || localStorage.getItem(dismissKey)) return '';
  const steps = isIOS()
    ? 'Tap the <strong>Share</strong> icon, then <strong>Add to Home Screen</strong>.'
    : 'Tap the <strong>⋮</strong> menu, then <strong>Add to Home screen</strong> (or <strong>Install app</strong>).';
  return `
    <div class="card install-hint" id="installHint" data-dismiss-key="${dismissKey}">
      <div class="row">
        <div>
          <div style="font-weight:700;">Add this to your Home Screen</div>
          <div class="item-meta">${steps} ${blurb}</div>
        </div>
        <button class="btn ghost small" id="installHintDismiss">×</button>
      </div>
    </div>
  `;
}
function wireInstallHint(){
  const el = document.getElementById('installHint');
  if(!el) return;
  document.getElementById('installHintDismiss').onclick = ()=>{
    localStorage.setItem(el.dataset.dismissKey, '1');
    el.remove();
  };
}
