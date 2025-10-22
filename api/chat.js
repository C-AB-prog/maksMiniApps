// api/chat.js
export const config = { runtime: 'edge' };

/* ---------- Telegram helpers (Edge) ---------- */
function parseTelegramUser(initData) {
  try {
    const p = new URLSearchParams(initData || '');
    const raw = p.get('user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function hmac(keyBytes, msgBytes) {
  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, msgBytes));
}
function hex(u8) { return [...u8].map(b => b.toString(16).padStart(2,'0')).join(''); }

async function verifyTelegramInitEdge(initData, botToken) {
  if (!initData || !botToken) return false;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash') || '';
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort((a,b)=>a[0].localeCompare(b[0]))
    .map(([k,v]) => `${k}=${v}`)
    .join('\n');

  const enc = new TextEncoder();
  const secret = await hmac(enc.encode('WebAppData'), enc.encode(botToken)); // HMAC(WebAppData, botToken)
  const calc   = await hmac(secret, enc.encode(dataCheckString));            // HMAC(secret, data)
  return hex(calc) === hash;
}

/* ---------- OpenAI call ---------- */
async function callOpenAI(message, system) {
  const key      = process.env.OPENAI_API_KEY;
  const model    = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const baseURL  = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const orgId    = process.env.OPENAI_ORG || '';
  const project  = process.env.OPENAI_PROJECT || '';

  if (!key) {
    return { error: 'NO_OPENAI_KEY: задайте OPENAI_API_KEY в Vercel → Settings → Environment Variables.' };
  }

  const payload = {
    model,
    temperature: 0.3,
    max_tokens: 400,
    messages: [
      { role: 'system', content: system },
      { role: 'user',   content: message }
    ]
  };

  // Собираем заголовки аккуратно, без undefined
  const headers = {
    'content-type': 'application/json',
    'authorization': `Bearer ${key}`
  };
  if (orgId)   headers['OpenAI-Organization'] = orgId;   // для мульти-орг сценариев (опционально)
  if (project) headers['OpenAI-Project']      = project; // для sk-proj ключей (если требуется)

  const r = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });

  if (!r.ok) {
    const txt = await r.text();
    // Вернём коротко и по делу — чтобы видеть корень проблемы (401/429/…)
    return { error: `OPENAI_ERROR: ${r.status} ${r.statusText} · ${txt.slice(0, 300)}` };
  }

  const j = await r.json();
  const reply = j?.choices?.[0]?.message?.content?.trim();
  return { reply: reply || 'Не уверен, уточните вопрос.' };
}

/* ---------- Handler ---------- */
export default async function handler(req) {
  try {
    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: { 'Allow': 'POST' } });
    }

    const init = req.headers.get('x-telegram-init') || '';
    const ok   = await verifyTelegramInitEdge(init, process.env.BOT_TOKEN || '');
    if (!ok)  return Response.json({ error: 'INVALID_TELEGRAM_SIGNATURE' }, { status: 401 });

    const user = parseTelegramUser(init);
    if (!user?.id) return Response.json({ error: 'NO_TELEGRAM_USER' }, { status: 400 });

    const { message } = await req.json().catch(()=>({}));
    const text = String(message || '').trim().slice(0, 1000);
    if (!text) return Response.json({ error: 'MESSAGE_REQUIRED' }, { status: 400 });

    const system = [
      'Ты дружелюбный и лаконичный ассистент по планированию.',
      'Отвечай коротко и по делу; предлагай чек-листы и следующие шаги.',
      'Если нужен контекст задач — попроси уточнить.'
    ].join(' ');

    const out = await callOpenAI(text, system);
    if (out.error) return Response.json({ error: out.error }, { status: 500 });
    return Response.json({ reply: out.reply });

  } catch (e) {
    return Response.json({ error: e?.message || 'INTERNAL_ERROR' }, { status: 500 });
  }
}
