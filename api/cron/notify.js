// api/cron/notify.js
const { ensureSchema, query } = require("../_db");
const { buildDigestText } = require("../notify/_digest");

async function tgSendMessage(chatId, text) {
  const token =
    process.env.TELEGRAM_BOT_TOKEN ||
    process.env.BOT_TOKEN ||
    process.env.TG_BOT_TOKEN ||
    process.env.TELEGRAM_TOKEN;

  if (!token) throw new Error("Missing TELEGRAM_BOT_TOKEN (or BOT_TOKEN)");

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });

  const data = await resp.json().catch(() => ({}));
  if (!data.ok) throw new Error(`Telegram sendMessage failed: ${data.description || "unknown"}`);
  return data;
}

module.exports = async (req, res) => {
  try {
    await ensureSchema();

    // Protect cron endpoint (recommended)
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
      const auth = String(req.headers.authorization || "").trim();
      const qSecret = (req.query && req.query.secret) ? String(req.query.secret) : "";
      if (auth !== ("Bearer " + cronSecret) && qSecret !== cronSecret) {
        return res.status(401).json({ ok: false, error: "unauthorized" });
      }
    }

    const nowMs = Date.now();

    // Digest notifications (focus + today tasks + overdue) —
    // send at slots: start_hour + N*interval_hours, only in first 10 minutes of that hour.
    const prefs = await query(
      `
      SELECT p.user_id, p.interval_hours, p.start_hour, p.end_hour, p.tz_offset_min, p.last_sent_at, u.tg_id
      FROM notification_prefs p
      JOIN users u ON u.id = p.user_id
      WHERE p.enabled = true
      `
    );

    let digest_sent = 0;

    for (const p of prefs.rows) {
      const interval = Number(p.interval_hours || 4);
      const startH = Number(p.start_hour || 9);
      const endH = Number(p.end_hour || 21);
      const offset = Number(p.tz_offset_min || 0);

      // tz_offset_min is JS getTimezoneOffset (minutes): e.g. Moscow = -180
      const localMs = nowMs - offset * 60000;
      const d = new Date(localMs);
      const h = d.getUTCHours();
      const m = d.getUTCMinutes();

      if (h < startH || h > endH) continue;
      const mod = ((h - startH) % interval + interval) % interval;
      if (mod !== 0 || m > 10) continue;

      // already sent for this slot recently
      if (p.last_sent_at) {
        const lastMs = new Date(p.last_sent_at).getTime();
        if (nowMs - lastMs < interval * 3600000 - 600000) continue;
      }

      if (!p.tg_id) continue;

      const text = await buildDigestText({
        query,
        userId: p.user_id,
        tzOffsetMin: offset,
        nowMs,
      });

      await tgSendMessage(p.tg_id, text);
      await query(
        `UPDATE notification_prefs SET last_sent_at = now(), updated_at = now() WHERE user_id = $1`,
        [p.user_id]
      );

      digest_sent += 1;
    }

    return res.status(200).json({ ok: true, digest_sent });
  } catch (e) {
    console.error("cron/notify error:", e);
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
};
