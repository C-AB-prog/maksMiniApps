/* ===== helpers ===== */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const showToast = (t) => console.log('[toast]', t);

/* ===== tg_id ===== */
let tgId = 0;

function readTgId() {
  // 1) Telegram WebApp
  try {
    const wa = window.Telegram?.WebApp?.initDataUnsafe;
    const uid = wa?.user?.id;
    if (uid && /^\d+$/.test(String(uid))) return Number(uid);
  } catch {}
  // 2) URL ?tg_id=
  const qid = new URLSearchParams(location.search).get('tg_id');
  if (qid && /^\d+$/.test(qid)) return Number(qid);
  // 3) localStorage
  const ls = localStorage.getItem('tg_id');
  if (ls && /^\d+$/.test(ls)) return Number(ls);
  return 0;
}

function saveTgIdLocal(id) {
  if (id && /^\d+$/.test(String(id))) {
    localStorage.setItem('tg_id', String(id));
    tgId = Number(id);
    renderWho();
  }
}

function renderWho() {
  const el = document.getElementById('who');
  if (el) el.textContent = `tg_id: ${tgId || '—'}`;
}

/* ===== status badge ===== */
async function ping() {
  try {
    const r = await fetch('/api/ping', {
      headers: tgId ? { 'X-TG-ID': String(tgId) } : {}
    });
    const j = await r.json();
    const ok = !!j?.ok;
    const badge = document.getElementById('badge');
    if (badge) {
      badge.textContent = ok ? 'online' : 'offline';
      badge.className = `badge ${ok ? 'ok' : 'off'}`;
    }
    return ok;
  } catch {
    const badge = document.getElementById('badge');
    if (badge) {
      badge.textContent = 'offline';
      badge.className = 'badge off';
    }
    return false;
  }
}

/* ===== chat ===== */
const chatLog = document.getElementById('chatLog');

function renderMessages(list) {
  if (!chatLog) return;
  chatLog.innerHTML = '';
  for (const m of list) {
    const div = document.createElement('div');
    div.className = `msg ${m.role}`;
    div.textContent = m.content;
    chatLog.appendChild(div);
  }
  chatLog.scrollTop = chatLog.scrollHeight;
}

async function loadHistory() {
  if (!tgId) return;
  const r = await fetch(`/api/chat-history?tg_id=${tgId}`, {
    headers: tgId ? { 'X-TG-ID': String(tgId) } : {}
  });
  const j = await r.json().catch(() => ({}));
  if (j?.ok) renderMessages(j.messages || []);
}

async function sendMessage() {
  const box = document.getElementById('msg');
  const message = box.value.trim();
  if (!message) return;

  box.value = '';

  // оптимистичный рендер
  const current = $$('.msg').map(el => ({
    role: el.classList.contains('user') ? 'user' : 'assistant',
    content: el.textContent
  }));
  renderMessages([...current, { role: 'user', content: message }, { role: 'assistant', content: '…' }]);

  const r = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(tgId ? { 'X-TG-ID': String(tgId) } : {})
    },
    body: JSON.stringify({ message, tg_id: tgId })
  });

  const j = await r.json().catch(() => ({}));
  if (!j?.ok) showToast('Ошибка чата');
  await loadHistory();
}

/* ===== tasks (если уже есть бэкенд) ===== */
async function loadTasks() {
  if (!tgId) return;
  const r = await fetch(`/api/tasks?tg_id=${tgId}`, {
    headers: tgId ? { 'X-TG-ID': String(tgId) } : {}
  });
  const j = await r.json().catch(() => ({}));
  if (!j?.ok) return;
  const box = document.getElementById('tasks');
  if (!box) return;
  box.innerHTML = '';
  for (const t of j.items || []) {
    const row = document.createElement('div');
    row.className = 'taskitem';
    row.innerHTML = `
      <input type="checkbox" ${t.done ? 'checked' : ''} data-id="${t.id}" />
      <div>
        <div>${t.title}</div>
        <small class="muted">${t.due_at ? new Date(t.due_at).toLocaleString('ru-RU') : 'без срока'}</small>
      </div>
      <button data-del="${t.id}">Удалить</button>
    `;
    box.appendChild(row);
  }
  $$('#tasks input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', async e => {
      const id = Number(e.target.getAttribute('data-id'));
      const done = e.target.checked;
      await fetch('/api/tasks', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(tgId ? { 'X-TG-ID': String(tgId) } : {})
        },
        body: JSON.stringify({ id, done, tg_id: tgId })
      });
      await loadTasks();
    });
  });
  $$('#tasks button[data-del]').forEach(btn => {
    btn.addEventListener('click', async e => {
      const id = Number(e.target.getAttribute('data-del'));
      await fetch('/api/tasks', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...(tgId ? { 'X-TG-ID': String(tgId) } : {})
        },
        body: JSON.stringify({ id, tg_id: tgId })
      });
      await loadTasks();
    });
  });
}

async function addTask() {
  const title = document.getElementById('taskTitle')?.value.trim();
  const dueRaw = document.getElementById('taskDue')?.value;
  const due_at = dueRaw ? new Date(dueRaw).toISOString() : null;
  if (!title) return;
  await fetch('/api/tasks', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(tgId ? { 'X-TG-ID': String(tgId) } : {})
    },
    body: JSON.stringify({ title, due_at, tg_id: tgId })
  });
  document.getElementById('taskTitle').value = '';
  document.getElementById('taskDue').value = '';
  await loadTasks();
}

/* ===== init ===== */
document.getElementById('saveTg')?.addEventListener('click', () => {
  const val = document.getElementById('tgInput')?.value.trim();
  if (val && /^\d+$/.test(val)) {
    saveTgIdLocal(val);
    ping(); loadHistory(); loadTasks();
  }
});

document.getElementById('send')?.addEventListener('click', sendMessage);
document.getElementById('msg')?.addEventListener('keydown', e => e.key === 'Enter' ? sendMessage() : null);
document.getElementById('addTask')?.addEventListener('click', addTask);

(async function boot() {
  tgId = readTgId();
  renderWho();
  if (tgId) {
    const tgInput = document.getElementById('tgInput');
    if (tgInput) tgInput.value = String(tgId);
  }
  await ping();
  await loadHistory();
  await loadTasks();
  // простой поллинг для синхронизации между устройствами
  setInterval(loadHistory, 8000);
  setInterval(loadTasks, 15000);
})();
