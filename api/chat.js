// api/chat.js
// Умный чат для Growth Assistant: интенты + вызов внутренних API.
// Требуется переменная окружения OPENAI_API_KEY (у тебя уже есть).

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  try {
    const { text, message, tg_id } = await readJson(req);
    const userText = (text || message || '').toString().trim();
    if (!userText) return res.status(400).json({ ok: false, error: 'Empty message' });

    // Определим базовый URL для внутренних вызовов
    const proto = (req.headers['x-forwarded-proto'] || 'https').toString();
    const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString();
    const baseUrl = `${proto}://${host}`;

    // Telegram ID берём из заголовка X-TG-ID или тела
    const tgIdHeader = (req.headers['x-tg-id'] || '').toString();
    const tgId = (tg_id || tgIdHeader || '').toString();

    // 1) Пытаемся извлечь интент «добавить задачу / установить фокус / просто ответить»
    const intent = await extractIntent(userText);

    // 2) Выполняем действие, если есть
    if (intent.action === 'add_task' && intent.title) {
      // Извлекаем дедлайн (ms) если есть
      const due_ts = Number.isFinite(intent.due_ts) ? intent.due_ts : null;
      try {
        const r = await fetch(`${baseUrl}/api/tasks`, {
          method: 'POST',
          headers: headersJson(tgId),
          body: JSON.stringify({ title: intent.title, due_ts })
        });
        if (!r.ok) throw new Error(await safeErr(r));
        const j = await r.json().catch(() => ({}));
        const when = due_ts ? ' (дедлайн: ' + fmtDate(due_ts) + ')' : '';
        const reply = `Готово: добавил задачу «${j?.task?.title || intent.title}»${when}.`;
        return res.status(200).json({ ok: true, reply });
      } catch (e) {
        // Даже если не получилось — красиво ответим
        const when = intent.due_ts ? ' к ' + fmtDate(intent.due_ts) : '';
        return res.status(200).json({
          ok: true,
          reply: `Понял, добавлю задачу «${intent.title}»${when}. Сейчас сервер недоступен, попробуй ещё раз чуть позже.`
        });
      }
    }

    if (intent.action === 'set_focus' && intent.focus_text) {
      try {
        const r = await fetch(`${baseUrl}/api/focus`, {
          method: 'POST',
          headers: headersJson(tgId),
          body: JSON.stringify({ text: intent.focus_text })
        });
        if (!r.ok) throw new Error(await safeErr(r));
        await r.json().catch(() => ({}));
        const reply = `Фокус обновлён: «${intent.focus_text}». Держу тебя в тонусе!`;
        return res.status(200).json({ ok: true, reply });
      } catch (e) {
        return res.status(200).json({
          ok: true,
          reply: `Фокус хочу поставить на «${intent.focus_text}», но сервер сейчас не ответил. Попробуй повторить позже.`
        });
      }
    }

    // 3) Если явного действия нет — просим LLM дать умный краткий ответ/план
    const reply = await llmPlanReply(userText);
    return res.status(200).json({ ok: true, reply });

  } catch (e) {
    // Фоллбэк: в любом случае отвечаем человечески
    return res.status(200).json({
      ok: true,
      reply: `Я немного задумался 😅 Напиши, что нужно: «добавь задачу ... завтра в 15:00» или «поставь фокус ...».`
    });
  }
}

/* ========================= Helpers ========================= */

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

/* ====== 1) Интент-классификация через OpenAI ====== */

async function extractIntent(userText) {
  // Быстрые эвристики до LLM (удешевляем и ускоряем):
  const t = userText.toLowerCase();
  // Прямые команды
  if (/^(добав(ь|ить)|создай|создать)\s+задач[ауы]/.test(t)) {
    return { action: 'add_task', title: stripVerb(userText), due_ts: tryParseDue(userText) };
  }
  if (/^(фокус|поставь фокус|обнови фокус)/.test(t)) {
    return { action: 'set_focus', focus_text: stripFocus(userText) };
  }

  // Иначе — спросим модель на JSON
  const apiKey = process.env.OPENAI_API_KEY || '';
  if (!apiKey) return { action: 'reply' };

  const OpenAI = (await import('openai')).default;
  const openai = new OpenAI({ apiKey });

  const sys = [
    "Ты помощник планирования. Верни ТОЛЬКО JSON следующего вида:",
    `{ "action": "add_task|set_focus|reply", "title": "...", "due_ts": 0, "focus_text": "..." }`,
    "Если можно создать задачу — заполни title (каротко), due_ts (UNIX ms) если понимаешь срок, иначе 0.",
    "Если просят фокус — заполни focus_text (кратко).",
    "Если непонятно — action=reply и опиши как помочь коротко."
  ].join('\n');

  const user = `Сообщение пользователя: """${userText}"""\nВерни только JSON.`;

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
  } catch { /* fallback ниже */ }

  // Очистка значений
  if (parsed.action === 'add_task') {
    parsed.title = (parsed.title || '').toString().trim() || guessTitle(userText);
    const modelDue = Number(parsed.due_ts || 0);
    parsed.due_ts = Number.isFinite(modelDue) && modelDue > 0 ? modelDue : tryParseDue(userText);
  }
  if (parsed.action === 'set_focus') {
    parsed.focus_text = (parsed.focus_text || '').toString().trim() || guessFocus(userText);
  }
  if (!parsed.action) parsed.action = 'reply';
  return parsed;
}

function stripVerb(s) {
  // «Добавь/Создай задачу ...» -> заголовок без глагола и слова "задачу"
  return s.replace(/^(добав(ь|ить)|создай|создать)\s+задач[ауы]\s*/i, '').trim();
}
function stripFocus(s) {
  // «Фокус ...» / «Поставь фокус ...» -> текст
  return s.replace(/^(постав(ь|ить)\s+)?фокус( дня)?\s*[:-]?\s*/i, '').trim();
}
function guessTitle(s) { return s.trim().slice(0, 120); }
function guessFocus(s) { return s.trim().slice(0, 160); }

/* Простенький парсер времени (RU): сегодня/завтра/послезавтра + «в 15:30»/«к 18:00» */
function tryParseDue(text) {
  const t = text.toLowerCase();
  const now = new Date();
  let base = new Date(now);

  if (/\bсегодня\b/.test(t)) base = new Date(now);
  else if (/\bзавтра\b/.test(t)) base = addDaysLocal(now, 1);
  else if (/\bпослезавтра\b/.test(t)) base = addDaysLocal(now, 2);
  else {
    // день недели (пн..вс)
    const dow = ['вс','пн','вт','ср','чт','пт','сб'];
    const map = { 'понедельник':'пн','вторник':'вт','среда':'ср','четверг':'чт','пятница':'пт','суббота':'сб','воскресенье':'вс' };
    let target = null;
    for (const w of Object.keys(map)) if (t.includes(w)) target = map[w];
    if (!target) for (const d of dow) if (new RegExp(`\\b${d}\\b`).test(t)) target = d;

    if (target) {
      const cur = now.getDay();                    // 0..6 (вс..сб)
      const idx = dow.indexOf(target);             // 0..6
      let diff = idx - cur;
      if (diff <= 0) diff += 7;
      base = addDaysLocal(now, diff);
    }
  }

  // время «в 15:30» или «к 18:00»
  const m = t.match(/\b(?:в|к)\s*(\d{1,2})(?::(\d{2}))?\b/);
  if (m) {
    const hh = clamp(parseInt(m[1], 10), 0, 23);
    const mm = clamp(parseInt(m[2] || '0', 10), 0, 59);
    base.setHours(hh, mm, 0, 0);
  } else {
    // если конкретно «сегодня/завтра/неделя» без времени — ставим 19:00
    if (/\b(сегодня|завтра|послезавтра)\b/.test(t)) base.setHours(19, 0, 0, 0);
  }
  return base.getTime();

  function addDaysLocal(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }
}

/* ====== 2) Короткий умный ответ-план ====== */
async function llmPlanReply(userText) {
  const apiKey = process.env.OPENAI_API_KEY || '';
  if (!apiKey) {
    // Без ключа — легкий оффлайн-ответ
    return `Давай разберём на шаги. Сформулируй: цель, срок и 3–5 подзадач — я превращу это в задачи и фокус.`;
  }

  const OpenAI = (await import('openai')).default;
  const openai = new OpenAI({ apiKey });

  const sys = [
    "Ты деловой ассистент. Кратко и по делу.",
    "Формат ответа: 1–3 предложения + маркированный чек-лист (до 5 пунктов).",
    "Избегай воды; предлагай конкретные действия и дедлайны."
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
