// api/chat.js
// Чат с LLM + сохранение сессий в БД (chat_sessions / chat_messages)

import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

// --- утилиты БД ---

async function dbQuery(text, params = []) {
  const client = await pool.connect();
  try {
    const res = await client.query(text, params);
    return res.rows;
  } finally {
    client.release();
  }
}

async function dbOne(text, params = []) {
  const rows = await dbQuery(text, params);
  return rows[0] || null;
}

async function getOrCreateUser(tgId) {
  if (!tgId) return null;
  const existing = await dbOne('SELECT id FROM users WHERE tg_id = $1', [tgId]);
  if (existing) return existing.id;
  const created = await dbOne(
    'INSERT INTO users (tg_id) VALUES ($1) ON CONFLICT (tg_id) DO UPDATE SET tg_id = EXCLUDED.tg_id RETURNING id',
    [tgId]
  );
  return created?.id || null;
}

// --- OpenAI агент ---

async function runAgentLLM(userText, history) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set');
  }

  const OpenAI = (await import('openai')).default;
  const openai = new OpenAI({ apiKey });

  const sys = [
    'Ты — деловой ассистент Growth Assistant.',
    'Отвечай кратко и по делу, без воды.',
    'Структурируй ответ: 1–3 предложения + при необходимости маркированный список до 5 пунктов.',
    'Говори дружелюбно, на "ты".',
  ].join('\n');

  const messages = [
    { role: 'system', content: sys },
    ...(history || []).map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content.toString().slice(0, 2000),
    })),
    { role: 'user', content: userText.toString().slice(0, 2000) },
  ];

  const resp = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.25,
    messages,
  });

  const msg = resp.choices?.[0]?.message?.content || '';
  return msg.trim() || 'Готово.';
}

// --- handler ---

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  try {
    const body = typeof req.body === 'object' && req.body !== null
      ? req.body
      : JSON.parse(req.body || '{}');

    const text = (body.text || '').toString().trim();
    const chatIdFromClient = body.chat_id ? Number(body.chat_id) : null;
    const chatTitle = (body.chat_title || '').toString().trim() || null;

    if (!text) {
      return res.status(400).json({ ok: false, error: 'Empty message' });
    }

    // tg_id из хедера или тела
    const tgIdHeader = (req.headers['x-tg-id'] || '').toString();
    const tgIdBody = (body.tg_id || '').toString();
    const tgId = tgIdBody || tgIdHeader || null;

    let userId = null;
    try {
      userId = await getOrCreateUser(tgId);
    } catch (e) {
      // если БД недоступна — продолжаем работать без сохранения истории
      console.error('[chat] user error', e);
    }

    // --- гарантируем сессию в chat_sessions ---
    let sessionId = null;

    if (userId && chatIdFromClient) {
      try {
        const row = await dbOne(
          'SELECT id FROM chat_sessions WHERE id = $1 AND tg_id = $2',
          [chatIdFromClient, tgId]
        );
        if (row) sessionId = row.id;
      } catch (e) {
        console.error('[chat] check session error', e);
      }
    }

    if (userId && !sessionId) {
      try {
        const title =
          chatTitle ||
          (text.length > 40 ? text.slice(0, 37) + '…' : text) ||
          'Чат';
        const row = await dbOne(
          `INSERT INTO chat_sessions (tg_id, title)
           VALUES ($1, $2)
           RETURNING id`,
          [tgId, title]
        );
        sessionId = row?.id || null;
      } catch (e) {
        console.error('[chat] create session error', e);
      }
    }

    // --- сохраняем пользовательское сообщение ---
    if (sessionId) {
      try {
        await dbQuery(
          `INSERT INTO chat_messages (session_id, role, content)
           VALUES ($1, 'user', $2)`,
          [sessionId, text]
        );
        await dbQuery(
          `UPDATE chat_sessions SET updated_at = now() WHERE id = $1`,
          [sessionId]
        );
      } catch (e) {
        console.error('[chat] insert user msg error', e);
      }
    }

    // --- достаём историю для контекста (по желанию, последние 10 сообщений) ---
    let history = [];
    if (sessionId) {
      try {
        const rows = await dbQuery(
          `SELECT role, content
           FROM chat_messages
           WHERE session_id = $1
           ORDER BY id DESC
           LIMIT 10`,
          [sessionId]
        );
        history = rows.reverse().map(r => ({
          role: r.role,
          content: r.content,
        }));
      } catch (e) {
        console.error('[chat] history error', e);
      }
    }

    // --- LLM ответ ---
    let replyText;
    try {
      replyText = await runAgentLLM(text, history);
    } catch (e) {
      console.error('[chat] LLM error', e);
      replyText =
        'Сейчас не получается подключиться к модели. ' +
        'Но я могу помочь офлайн: подсказать, как разбить задачи, спланировать день или неделю.';
    }

    // --- сохраняем ответ ассистента ---
    if (sessionId) {
      try {
        await dbQuery(
          `INSERT INTO chat_messages (session_id, role, content)
           VALUES ($1, 'assistant', $2)`,
          [sessionId, replyText]
        );
        await dbQuery(
          `UPDATE chat_sessions SET updated_at = now() WHERE id = $1`,
          [sessionId]
        );
      } catch (e) {
        console.error('[chat] insert bot msg error', e);
      }
    }

    return res.status(200).json({
      ok: true,
      reply: replyText,
      chat_id: sessionId,
    });
  } catch (e) {
    console.error('[chat] fatal error:', e);
    return res.status(200).json({
      ok: true,
      reply:
        'Я на секунду задумался 😅 Но уже снова в строю — напиши, что нужно сделать или спланировать.',
      chat_id: null,
    });
  }
}
