// ---------- Telegram ID detection ----------
function detectTgId() {
  // 1) Telegram Mini App
  const tgIdFromTMA = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
  if (tgIdFromTMA) {
    localStorage.setItem('tg_id', String(tgIdFromTMA));
    return Number(tgIdFromTMA);
  }
  // 2) URL ?tg_id= (на случай desktop теста)
  const url = new URL(location.href);
  const qId = url.searchParams.get('tg_id');
  if (qId && /^\d+$/.test(qId)) {
    localStorage.setItem('tg_id', qId);
    return Number(qId);
  }
  // 3) LocalStorage (для dev в браузере)
  const ls = localStorage.getItem('tg_id');
  if (ls && /^\d+$/.test(ls)) return Number(ls);

  // 4) Ничего нет — пусть бекенд вернёт 400, а мы покажем тост
  return null;
}
const TG_ID = detectTgId();

// ---------- Helpers ----------
function toast(msg, ms = 2200) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.style.display = 'none'), ms);
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (TG_ID != null) headers['x-tg-id'] = String(TG_ID);

  const res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify({ tg_id: TG_ID, ...body }) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || `HTTP ${res.status}`);
  }
  return data;
}

// ---------- UI refs ----------
const elFocusText = document.getElementById('focusText');
const elSaveFocus = document.getElementById('btnSaveFocus');

const elTaskTitle = document.getElementById('taskTitle');
const elTaskDue = document.getElementById('taskDue');
const elAddTask = document.getElementById('btnAddTask');
const elTabs = document.querySelectorAll('.tab');
const elList = document.getElementById('tasksList');

let currentRange = 'today';

// ---------- Events ----------
elTabs.forEach(t => {
  t.addEventListener('click', () => {
    elTabs.forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    currentRange = t.dataset.range;
  });
});

elSaveFocus.addEventListener('click', async () => {
  try {
    await api('/api/focus', { method: 'POST', body: { text: elFocusText.value.trim() } });
    toast('Фокус сохранён ✅');
    elFocusText.value = '';
    // не грузим список фокусов, достаточно тоста
  } catch (e) {
    toast(`focus: ${e.message}`);
  }
});

elAddTask.addEventListener('click', async () => {
  const title = elTaskTitle.value.trim();
  if (!title) {
    toast('Введите название задачи');
    return;
  }
  let due_ts = null;
  if (currentRange === 'today') {
    // если поле пустое — срок сегодня 23:59
    const d = elTaskDue.value ? new Date(elTaskDue.value) : new Date();
    if (!elTaskDue.value) { d.setHours(23, 59, 0, 0); }
    due_ts = d.toISOString();
  } else if (currentRange === 'week') {
    const d = elTaskDue.value ? new Date(elTaskDue.value) : new Date();
    // конец недели (вс) 23:59
    const day = d.getDay(); // 0..6
    const diff = 7 - day;   // до вс
    d.setDate(d.getDate() + diff);
    d.setHours(23, 59, 0, 0);
    due_ts = d.toISOString();
  } else {
    // backlog — без срока
    due_ts = null;
  }

  // Оптимистично в UI:
  const temp = renderItem({ id: `tmp-${Date.now()}`, title, due_ts, done: false }, true);
  elList.prepend(temp);

  try {
    const { item } = await api('/api/tasks', { method: 'POST', body: { title, due_ts } });
    // Заменим временный элемент реальным
    temp.replaceWith(renderItem(item));
    elTaskTitle.value = '';
    elTaskDue.value = '';
  } catch (e) {
    temp.remove();
    toast(`tasks: ${e.message}`);
  }
});

async function toggleTask(id, done) {
  const card = document.querySelector(`[data-id="${id}"]`);
  if (card) card.style.opacity = .5;
  try {
    await api('/api/tasks', { method: 'PATCH', body: { id, done } });
    if (card) card.style.opacity = 1;
    if (card) {
      card.querySelector('.muted').textContent = done ? 'Готово' : 'Активна';
      card.querySelector('.btnToggle').textContent = done ? '↩︎' : '✓';
    }
  } catch (e) {
    if (card) card.style.opacity = 1;
    toast(`toggle: ${e.message}`);
  }
}

async function deleteTask(id) {
  const card = document.querySelector(`[data-id="${id}"]`);
  if (card) card.style.opacity = .5;
  try {
    await api('/api/tasks', { method: 'DELETE', body: { id } });
    if (card) card.remove(); // создаём видимость моментального удаления
  } catch (e) {
    if (card) card.style.opacity = 1;
    toast(`delete: ${e.message}`);
  }
}

// ---------- Initial load ----------
async function loadTasks() {
  try {
    const { items } = await api('/api/tasks'); // GET
    elList.innerHTML = '';
    items.forEach(item => elList.appendChild(renderItem(item)));
  } catch (e) {
    toast(`load: ${e.message}`);
  }
}

function renderItem(t, isTemp = false) {
  const el = document.createElement('div');
  el.className = 'item';
  el.dataset.id = t.id;

  const title = document.createElement('div');
  title.textContent = t.title;

  const meta = document.createElement('div');
  meta.className = 'muted';
  meta.textContent = t.done ? 'Готово' : (t.due_ts ? new Date(t.due_ts).toLocaleString() : 'Без срока');

  const act = document.createElement('div');
  act.className = 'row';
  act.style.flex = '0 0 auto';
  act.style.gap = '6px';

  const btnT = document.createElement('button');
  btnT.className = 'btn ghost btnToggle';
  btnT.textContent = t.done ? '↩︎' : '✓';
  btnT.onclick = () => toggleTask(t.id, !t.done);

  const btnD = document.createElement('button');
  btnD.className = 'btn danger';
  btnD.textContent = '✕';
  btnD.onclick = () => deleteTask(t.id);

  act.append(btnT, btnD);
  el.append(title, meta, act);
  if (isTemp) el.style.opacity = .7;
  return el;
}

(async function boot() {
  if (TG_ID == null) {
    toast('tg_id не найден (открой из Telegram Mini App или добавь ?tg_id=123 в URL)');
  }
  await loadTasks();
})();
