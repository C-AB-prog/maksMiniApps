// api/chat.js
// Умный чат для Growth Assistant: интенты + действия с задачами/фокусом.
// Требуется OPENAI_API_KEY в переменных окружения Vercel.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  try {
    const { text, message, tg_id } = await readJson(req);
    const userText = (text || message || '').toString().trim();
    if (!userText) return res.status(400).json({ ok: false, error: 'Empty message' });

    // База для внутренних вызовов
    const proto = (req.headers['x-forwarded-proto'] || 'https').toString();
    const host  = (req.headers['x-forwarded-host']  || req.headers.host || '').toString();
    const baseUrl = `${proto}://${host}`;

    // Идентификатор пользователя
    const tgIdHeader = (req.headers['x-tg-id'] || '').toString();
    const tgId = (tg_id || tgIdHeader || '').toString();

    // 1) Извлечь интент
    const intent = await extractIntent(userText);

    // 2) Выполнить действие
    if (intent.action === 'add_task' && intent.title) {
      const due_ts = Number.isFinite(intent.due_ts) ? intent.due_ts : null;
      return await doAddTask(res, baseUrl, tgId, intent.title, due_ts);
    }

    if (intent.action === 'set_focus' && intent.focus_text) {
      return await doSetFocus(res, baseUrl, tgId, intent.focus_text);
    }

    if (intent.action === 'list_tasks') {
      const period = intent.period || guessPeriod(userText);
      return await doListTasks(res, baseUrl, tgId, period);
    }

    if (intent.action === 'delete_task' && intent.query) {
      return await doDeleteTask(res, baseUrl, tgId, intent.query);
    }

    if (intent.action === 'complete_task' && intent.query) {
      return await doCompleteTask(res, baseUrl, tgId, intent.query);
    }

    // 3) Иначе — короткий умный ответ/план
    const reply = await llmPlanReply(userText);
    return res.status(200).json({ ok: true, reply });

  } catch (e) {
    return res.status(200).json({
      ok: true,
      reply: `Я на секунду задумался 😅 Напиши: «добавь задачу … завтра в 15:00», «поставь фокус …», «покажи задачи на неделю», «удали задачу …».`
    });
  }
}

/* ========================= ДЕЙСТВИЯ ========================= */

async function doAddTask(res, baseUrl, tgId, title, due_ts) {
  try {
    const r = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: headersJson(tgId),
      body: JSON.stringify({ title, due_ts: due_ts ?? null })
    });
    if (!r.ok) throw new Error(await safeErr(r));
    const j = await r.json().catch(() => ({}));
    const when = due_ts ? ` (дедлайн: ${fmtDate(due_ts)})` : '';
    return res.status(200).json({ ok: true, reply: `Готово: добавил задачу «${j?.task?.title || title}»${when}.` });
  } catch (e) {
    const when = due_ts ? ` к ${fmtDate(due_ts)}` : '';
    return res.status(200).json({
      ok: true,
      reply: `Понял, добавлю задачу «${title}»${when}. Сейчас сервер недоступен, попробуй ещё раз чуть позже.`
    });
  }
}

async function doSetFocus(res, baseUrl, tgId, focus_text) {
  try {
    const r = await fetch(`${baseUrl}/api/focus`, {
      method: 'POST',
      headers: headersJson(tgId),
      body: JSON.stringify({ text: focus_text })
    });
    if (!r.ok) throw new Error(await safeErr(r));
    await r.json().catch(() => ({}));
    return res.status(200).json({ ok: true, reply: `Фокус обновлён: «${focus_text}». Держу тебя в тонусе!` });
  } catch (e) {
    return res.status(200).json({
      ok: true,
      reply: `Фокус хочу поставить на «${focus_text}», но сервер сейчас не ответил. Попробуй повторить позже.`
    });
  }
}

async function doListTasks(res, baseUrl, tgId, period = 'today') {
  try {
    const items = await fetchTasks(baseUrl, tgId);
    const now = Date.now();
    const range = calcRange(period);
    let filtered = items;

    if (period === 'backlog') {
      filtered = items.filter(t => t.due_ts == null);
    } else if (period === 'overdue') {
      filtered = items.filter(t => t.due_ts != null && t.due_ts < now && !t.is_done);
    } else if (range) {
      filtered = items.filter(t => t.due_ts != null && t.due_ts >= range.start && t.due_ts <= range.end);
    }

    filtered.sort((a,b)=>(a.is_done - b.is_done)||((a.due_ts ?? 1e18)-(b.due_ts ?? 1e18)));
    const reply = formatTasksList(filtered, period);
    return res.status(200).json({ ok: true, reply });
  } catch (e) {
    return res.status(200).json({ ok: true, reply: `Не удалось получить задачи. Попробуй ещё раз.` });
  }
}

async function doDeleteTask(res, baseUrl, tgId, query) {
  try {
    const items = await fetchTasks(baseUrl, tgId);
    const found = fuzzyFind(items, query);

    if (found.length === 0) {
      return res.status(200).json({ ok: true, reply: `Не нашёл задач по запросу «${query}».` });
    }
    if (found.length > 1) {
      const sample = found.slice(0, 5).map(t => `• ${t.title}`).join('\n');
      return res.status(200).json({
        ok: true,
        reply: `Нашёл несколько задач:\n${sample}\nУточни название.` 
      });
    }

    const t = found[0];
    try {
      const r = await fetch(`${baseUrl}/api/tasks/delete?id=${encodeURIComponent(t.id)}`, {
        method: 'POST',
        headers: headersJson(tgId),
        body: JSON.stringify({})
      });
      if (!r.ok) throw new Error(await safeErr(r));
      await r.json().catch(()=> ({}));
      return res.status(200).json({ ok: true, reply: `Удалил: «${t.title}».` });
    } catch {
      return res.status(200).json({ ok: true, reply: `Хотел удалить «${t.title}», но сервер не ответил. Попробуй позже.` });
    }
  } catch {
    return res.status(200).json({ ok: true, reply: `Не получилось получить список задач.` });
  }
}

async function doCompleteTask(res, baseUrl, tgId, query) {
  try {
    const items = await fetchTasks(baseUrl, tgId);
    const found = fuzzyFind(items, query);

    if (found.length === 0) {
      return res.status(200).json({ ok: true, reply: `Не нашёл задач по запросу «${query}».` });
    }
    if (found.length > 1) {
      const sample = found.slice(0, 5).map(t => `• ${t.title}${t.is_done?' (выполнено)':''}`).join('\n');
      return res.status(200).json({
        ok: true,
        reply: `Несколько совпадений:\n${sample}\nУточни точнее, какую закрыть.`
      });
    }

    const t = found[0];
    if (t.is_done) {
      return res.status(200).json({ ok: true, reply: `Задача уже выполнена: «${t.title}».` });
    }
    try {
      const r = await fetch(`${baseUrl}/api/tasks/toggle?id=${encodeURIComponent(t.id)}`, {
        method: 'POST',
        headers: headersJson(tgId),
        body: JSON.stringify({})
      });
      if (!r.ok) throw new Error(await safeErr(r));
      await r.json().catch(()=> ({}));
      return res.status(200).json({ ok: true, reply: `Отметил как выполненную: «${t.title}».` });
    } catch {
      return res.status(200).json({ ok: true, reply: `Хотел закрыть «${t.title}», но сервер не ответил. Попробуй позже.` });
    }
  } catch {
    return res.status(200).json({ ok: true, reply: `Не получилось получить список задач.` });
  }
}

/* ========================= HELPERS ========================= */

function headersJson(tgId) {
  const h = { 'Content-Type': 'application/json' };
  if (tgId) h['X-TG-ID'] = String(tgId);
  return h;
}

async function readJson(req) {
  try {
    const buf = await getRawBody(req);
    return JSON.parse(buf.toString('utf8') || '{}');
  } catch {
    return {};
  }
}

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function safeErr(r) {
  try { const j = await r.json(); return j?.error || `${r.status}`; }
  catch { return `${r.status}`; }
}

function fmtDate(ms) {
  try {
    return new Date(ms).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
  } catch { return ''; }
}

function startOfDay(d) { const x = new Date(d); x.setHours(0,0,0,0); return x.getTime(); }
function endOfDay(d)   { const x = new Date(d); x.setHours(23,59,59,999); return x.getTime(); }

function addDays(ts, n) { const x = new Date(ts); x.setDate(x.getDate()+n); return x.getTime(); }

function calcRange(period) {
  const now = Date.now();
  if (period === 'today') {
    return { start: startOfDay(now), end: endOfDay(now) };
  }
  if (period === 'tomorrow') {
    const t = addDays(now, 1);
    return { start: startOfDay(t), end: endOfDay(t) };
  }
  if (period === 'week') {
    return { start: startOfDay(now), end: endOfDay(addDays(now, 7)) };
  }
  // для backog/overdue/all — фильтруем отдельно
  return null;
}

function guessPeriod(t) {
  const s = (t || '').toLowerCase();
  if (/\bсегодня\b/.test(s)) return 'today';
  if (/\bзавтра\b/.test(s)) return 'tomorrow';
  if (/\bнедел(ю|я|е)\b/.test(s)) return 'week';
  if (/\bпросроч|overdue\b/.test(s)) return 'overdue';
  if (/\bбэклог|backlog\b/.test(s)) return 'backlog';
  if (/\bвсе\b/.test(s)) return 'all';
  return 'today';
}

function formatTasksList(items, period) {
  if (!items.length) {
    const label = periodRu(period);
    return `${label}: пусто.`;
  }
  const lines = items.slice(0, 20).map(t => {
    const mark = t.is_done ? '✓' : '•';
    const due = (t.due_ts!=null) ? ` — ${fmtDate(t.due_ts)}` : ' — бэклог';
    return `${mark} ${t.title}${due}`;
  }).join('\n');
  const label = periodRu(period);
  return `${label}:\n${lines}`;
}

function periodRu(p) {
  return {
    today: 'Задачи на сегодня',
    tomorrow: 'Задачи на завтра',
    week: 'Задачи на неделю',
    backlog: 'Бэклог',
    overdue: 'Просроченные',
    all: 'Все задачи'
  }[p] || 'Задачи';
}

async function fetchTasks(baseUrl, tgId) {
  const r = await fetch(`${baseUrl}/api/tasks`, { headers: headersJson(tgId) });
  if (!r.ok) throw new Error(await safeErr(r));
  const j = await r.json().catch(()=> ({}));
  return j.items || [];
}

function fuzzyFind(items, q) {
  const s = q.toLowerCase();
  // сначала точное вхождение
  let res = items.filter(t => (t.title || '').toLowerCase().includes(s));
  if (res.length) return res;
  // пробуем по словам
  const parts = s.split(/\s+/).filter(Boolean);
  if (!parts.length) return [];
  res = items.filter(t => {
    const lt = (t.title || '').toLowerCase();
    return parts.every(p => lt.includes(p));
  });
  return res;
}

/* ========================= ИНТЕНТЫ ========================= */

async function extractIntent(userText) {
  const t = userText.toLowerCase().trim();

  // 0) Быстрые эвристики (без модели)
  // Добавить задачу
  if (/^(добав(ь|ить)|создай|создать)\s+задач[ауы]\b/.test(t)) {
    return { action: 'add_task', title: stripAddVerb(userText), due_ts: tryParseDue(userText) };
  }
  // Фокус
  if (/^(постав(ь|ить)\s+)?фокус( дня)?\b/.test(t) || /^фокус\b/.test(t)) {
    return { action: 'set_focus', focus_text: stripFocus(userText) };
  }
  // Список задач
  if (/(покажи|список|выведи)\s+задач/.test(t) || /\b(сегодня|завтра|недел(ю|я|е)|бэклог|просроч)/.test(t)) {
    return { action: 'list_tasks', period: guessPeriod(t) };
  }
  // Удалить
  if (/(удали|удалить|сотри|стереть)\s+задач[уи]/.test(t)) {
    return { action: 'delete_task', query: stripDeleteVerb(userText) };
  }
  // Отметить выполненной
  if (/(закрой|закрыть|отметь|отметить)\s+(как\s+)?(сделан|выполнен)/.test(t) || /(пометь|пометить)\s+как\s+выполнен/.test(t)) {
    return { action: 'complete_task', query: stripCompleteVerb(userText) };
  }

  // 1) Модель (если есть ключ)
  const apiKey = process.env.OPENAI_API_KEY || '';
  if (!apiKey) return { action: 'reply' };

  const OpenAI = (await import('openai')).default;
  const openai = new OpenAI({ apiKey });

  const sys = [
    "Ты ассистент планирования. Верни ТОЛЬКО JSON:",
    `{ "action": "add_task|set_focus|list_tasks|delete_task|complete_task|reply",`,
    `  "title": "", "due_ts": 0, "focus_text": "", "period": "", "query": "" }`,
    "- add_task: заголовок в title (кратко), дедлайн в due_ts (UNIX ms) или 0",
    "- set_focus: текст фокуса в focus_text",
    "- list_tasks: period ∈ {today,tomorrow,week,backlog,overdue,all}",
    "- delete_task: query — часть названия для поиска",
    "- complete_task: query — часть названия для поиска",
    "Если непонятно — action=reply и краткий план."
  ].join('\n');

  const user = `Текст: """${userText}"""\nВерни только JSON.`;

  let parsed = { action: 'reply' };
  try {
    const r = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user }
      ]
    });
    const raw = r.choices?.[0]?.message?.content || '{}';
    parsed = JSON.parse(raw);
  } catch { /* noop */ }

  // Нормализация
  if (parsed.action === 'add_task') {
    parsed.title  = (parsed.title || '').toString().trim() || guessTitle(userText);
    const modelDue = Number(parsed.due_ts || 0);
    parsed.due_ts  = Number.isFinite(modelDue) && modelDue > 0 ? modelDue : tryParseDue(userText);
  }
  if (parsed.action === 'set_focus') {
    parsed.focus_text = (parsed.focus_text || '').toString().trim() || guessFocus(userText);
  }
  if (parsed.action === 'list_tasks') {
    parsed.period = normPeriod(parsed.period) || guessPeriod(userText);
  }
  if (parsed.action === 'delete_task' || parsed.action === 'complete_task') {
    parsed.query = (parsed.query || '').toString().trim() || guessTitle(userText);
  }

  if (!parsed.action) parsed.action = 'reply';
  return parsed;
}

/* ===== парсеры строк ===== */
function stripAddVerb(s) {
  return s.replace(/^(добав(ь|ить)|создай|создать)\s+задач[ауы]\s*/i, '').trim();
}
function stripFocus(s) {
  return s.replace(/^(постав(ь|ить)\s+)?фокус( дня)?\s*[:-]?\s*/i, '').trim();
}
function stripDeleteVerb(s) {
  return s.replace(/^(удали(ть)?|сотри|стереть)\s+задач[уы]\s*/i, '').trim();
}
function stripCompleteVerb(s) {
  return s.replace(/^(закрой|закрыть|отмет(ь|ить)|помет(ь|ить))\s+(как\s+)?(сделан(а)?|выполнен(а)?)\s*/i, '').trim();
}
function guessTitle(s) { return s.trim().slice(0, 120); }
function guessFocus(s) { return s.trim().slice(0, 160); }
function normPeriod(p) {
  if (!p) return '';
  const m = p.toLowerCase();
  if (['today','tomorrow','week','backlog','overdue','all'].includes(m)) return m;
  return '';
}

/* ===== простенький парсер сроков RU ===== */
function tryParseDue(text) {
  const t = text.toLowerCase();
  const now = new Date();
  let base = new Date(now);

  if (/\bсегодня\b/.test(t)) base = new Date(now);
  else if (/\bзавтра\b/.test(t)) base = addDaysLocal(now, 1);
  else if (/\bпослезавтра\b/.test(t)) base = addDaysLocal(now, 2);
  else {
    // дни недели
    const dow = ['вс','пн','вт','ср','чт','пт','сб'];
    const map = { 'понедельник':'пн','вторник':'вт','среда':'ср','четверг':'чт','пятница':'пт','суббота':'сб','воскресенье':'вс' };
    let target = null;
    for (const w of Object.keys(map)) if (t.includes(w)) target = map[w];
    if (!target) for (const d of dow) if (new RegExp(`\\b${d}\\b`).test(t)) target = d;

    if (target) {
      const cur = now.getDay(); // 0..6 (вс..сб)
      const idx = dow.indexOf(target);
      let diff = idx - cur;
      if (diff <= 0) diff += 7;
      base = addDaysLocal(now, diff);
    }
  }

  // «в 15:30» или «к 18:00»
  const m = t.match(/\b(?:в|к)\s*(\d{1,2})(?::(\d{2}))?\b/);
  if (m) {
    const hh = clamp(parseInt(m[1], 10), 0, 23);
    const mm = clamp(parseInt(m[2] || '0', 10), 0, 59);
    base.setHours(hh, mm, 0, 0);
  } else {
    if (/\b(сегодня|завтра|послезавтра)\b/.test(t)) base.setHours(19, 0, 0, 0);
  }
  return base.getTime();

  function addDaysLocal(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }
}

/* ===== короткий умный ответ-план ===== */
async function llmPlanReply(userText) {
  const apiKey = process.env.OPENAI_API_KEY || '';
  if (!apiKey) {
    return `Давай разберём на шаги. Напиши: цель, срок и 3–5 подзадач — превращу в задачи и фокус.`;
  }
  const OpenAI = (await import('openai')).default;
  const openai = new OpenAI({ apiKey });

  const sys = [
    "Ты деловой ассистент. Кратко и по делу.",
    "Формат: 1–3 предложения + чек-лист до 5 пунктов (буллеты).",
    "Предлагай конкретные действия и дедлайны. Не воды."
  ].join('\n');

  const r = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.3,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: userText }
    ]
  });

  const out = r.choices?.[0]?.message?.content?.trim();
  return out || 'Готово.';
}
