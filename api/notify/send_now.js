// api/notify/send_now.js (CommonJS)

const { ensureSchema, query, getOrCreateUserIdByTgId } = require('../_db');
const { buildDigestText } = require('./_digest');

function getTgId(req) {
  const h = req.headers || {};
  const q = req.query || {};
  const v = h['x-tg-id'] || h['X-TG-ID'] || q.tg_id || q.tgId || q.tgid;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function tgSendMessage(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || process.env.TG_BOT_TOKEN || process.env.TELEGRAM_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN missing');
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true
    })
  });

  const data = await r.json().catch(() => ({}));
  if (!data.ok) throw new Error(data.description || 'Telegram error');
  return data;
}

module.exports = async (req, res) => {
  try {
    await ensureSchema();

    const tgId = getTgId(req);
    if (!tgId) return res.status(400).json({ ok: false, error: 'no_tg_id' });

    const userId = await getOrCreateUserIdByTgId(tgId);

    // read tz offset (use saved settings if exist)
    const pref = await query(
      `SELECT tz_offset_min FROM notification_prefs WHERE user_id=$1`,
      [userId]
    );
    const tz_offset_min = Number(pref.rows[0]?.tz_offset_min ?? 0);

    const nowMs = Date.now();
    const text = await buildDigestText({ query, userId, tzOffsetMin: tz_offset_min, nowMs });

    await tgSendMessage(tgId, text);

    await query(
      `INSERT INTO notification_prefs (user_id, last_sent_at, updated_at)
       VALUES ($1, now(), now())
       ON CONFLICT (user_id) DO UPDATE SET last_sent_at=now(), updated_at=now()`,
      [userId]
    );

    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
};
