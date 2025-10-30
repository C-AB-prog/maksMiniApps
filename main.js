/* ===== helpers ===== */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

/* ===== tg_id: единая логика (телефон/ПК) ===== */
let tgId = 0;
function readTgId() {
  try {
    const wa = window.Telegram?.WebApp?.initDataUnsafe;
    const uid = wa?.user?.id;
    if (uid && /^\d+$/.test(String(uid))) return Number(uid);
  } catch {}
  const qid = new URLSearchParams(location.search).get('tg_id');
  if (qid && /^\d+$/.test(qid)) return Number(qid);
  const ls = localStorage.getItem('tg_id');
  if (ls && /^\d+$/.test(ls)) return Number(ls);
  return 0;
}
function saveTgIdLocal(id) {
  if (id && /^\d+$/.test(String(id))) {
    localStorage.setItem('tg_id', String(id));
    tgId = Number(id);
    const w = $('#who'); if (w) w.textContent = `tg_id: ${tgId}`;
  }
}

/* ===== online badge ===== */
async function ping() {
  try {
    const r = await fetch('/api/ping', { headers: tgId ? { 'X-TG-ID': String(tgId) } : {} });
    const ok = (await r.json())?.ok;
    const b = $('#badge'); if (b) { b.textContent = ok ? 'online' : 'offline'; b.className = 'badge ' + (ok ? 'ok' : 'off'); }
    return !!ok;
  } catch {
    const b = $('#badge'); if (b) { b.textContent = 'offline'; b.className = 'badge off'; }
    return false;
  }
}

/* ===== chat ===== */
function renderMessages(list) {
  const box = $('#chatLog'); if (!box) return;
  box.innerHTML = '';
  for (const m of list) {
    const d = document.createElement('div');
    d.className = `msg ${m.role}`;
    d.textContent = m.content;
    box.appendChild(d);
  }
  box.scrollTop = box.scrollHeight;
}
async function loadHistory() {
  if (!tgId) return;
  const r = await fetch(`/api/chat-history?tg_id=${tgId}`, { headers: { 'X-TG-ID': String(tgId) } });
  const j = await r.json().catch(()=>({}));
  if (j?.ok) renderMessages(j.messages || []);
}
async function sendMessage() {
  const inp = $('#msg'); const message = inp?.value?.trim(); if (!message) return;
  inp.value = '';

  const cur = $$('.msg').map(el => ({ role: el.classList.contains('user')?'user':'assistant', content: el.textContent }));
  renderMessages([...cur, { role: 'user', content: message }, { role: 'assistant', content: '…' }]);

  const r = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(tgId ? { 'X-TG-ID': String(tgId) } : {}) },
    body: JSON.stringify({ message, tg_id: tgId })
  });
  await r.json().catch(()=>({}));
  await loadHistory();
}

/* ===== tasks ===== */
function bindTasks() {
  $$('#tasks input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', async e => {
      const id = Number(e.target.getAttribute('data-id'));
      await fetch('/api/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-TG-ID': String(tgId) },
        body: JSON.stringify({ id, done: e.target.checked, tg_id: tgId })
      });
      await loadTasks();
    });
  });
  $$('#tasks button[data-del]').forEach(btn => {
    btn.addEventListener('click', async e => {
      const id = Number(e.target.getAttribute('data-del'));
      await fetch('/api/tasks', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'X-TG-ID': String(tgId) },
        body: JSON.stringify({ id, tg_id: tgId })
      });
      await loadTasks();
    });
  });
}
function renderTasks(items=[]) {
  const box = $('#tasks'); if (!box) return;
  box.innerHTML = items.map(t => `
    <div class="taskitem">
      <input type="checkbox" ${t.done?'checked':''} data-id="${t.id}" />
      <div>
        <div>${t.title}</div>
        <small class="muted">${t.due_at ? new Date(t.due_at).toLocaleString('ru-RU') : 'без срока'}</small>
      </div>
      <button data-del="${t.id}">Удалить</button>
    </div>`).join('');
  bindTasks();
}
async function loadTasks() {
  if (!tgId) return;
  const r = await fetch(`/api/tasks?tg_id=${tgId}`, { headers: { 'X-TG-ID': String(tgId) } });
  const j = await r.json().catch(()=>({}));
  if (j?.ok) renderTasks(j.items || []);
}
async function addTask() {
  const title = $('#taskTitle')?.value?.trim();
  const dueRaw = $('#taskDue')?.value;
  const due_at = dueRaw ? new Date(dueRaw).toISOString() : null;
  if (!title) return;
  await fetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(tgId?{'X-TG-ID':String(tgId)}:{}) },
    body: JSON.stringify({ title, due_at, tg_id: tgId })
  });
  $('#taskTitle').value = ''; if ($('#taskDue')) $('#taskDue').value = '';
  await loadTasks();
}

/* ===== focus ===== */
async function loadFocus() {
  const i = $('#focusInput'); if (!i || !tgId) return;
  try {
    const r = await fetch(`/api/focus?tg_id=${tgId}`, { headers: { 'X-TG-ID': String(tgId) } });
    const j = await r.json(); if (j?.ok) i.value = j.text || '';
  } catch {}
}
async function saveFocus() {
  const i = $('#focusInput'); if (!i || !tgId) return;
  const text = i.value || '';
  try {
    await fetch('/api/focus', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-TG-ID': String(tgId) },
      body: JSON.stringify({ text, tg_id: tgId })
    });
  } catch {}
}

/* ===== init ===== */
$('#saveTg')?.addEventListener('click', () => {
  const val = $('#tgInput')?.value?.trim();
  if (val && /^\d+$/.test(val)) { saveTgIdLocal(val); ping(); loadHistory(); loadTasks(); loadFocus(); }
});
$('#send')?.addEventListener('click', sendMessage);
$('#msg')?.addEventListener('keydown', e => e.key === 'Enter' ? sendMessage() : null);
$('#addTask')?.addEventListener('click', addTask);
$('#saveFocus')?.addEventListener('click', saveFocus);

(async function boot() {
  tgId = readTgId();
  const w = $('#who'); if (w) w.textContent = `tg_id: ${tgId || '—'}`;
  if (tgId && $('#tgInput')) $('#tgInput').value = String(tgId);

  await ping();
  await loadFocus();
  await loadHistory();
  await loadTasks();

  // пассивная синхронизация между устройствами
  setInterval(loadFocus, 10000);
  setInterval(loadHistory, 8000);
  setInterval(loadTasks, 15000);
})();
