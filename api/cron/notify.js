// api/cron/notify.js
const { ensureSchema, query } = require("../_db");

async function tgSendMessage(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Missing TELEGRAM_BOT_TOKEN");

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

  const data = await resp.json();
  if (!data.ok) throw new Error(`Telegram sendMessage failed: ${data.description}`);
  return data;
}

async function getLatestFocusText(user_id) {
  const f = await query(
    `SELECT text FROM focuses WHERE user_id=$1 ORDER BY id DESC LIMIT 1`,
    [user_id]
  );
  return f.rows[0]?.text || "";
}

function formatDueTs(due_ts) {
  if (!due_ts) return "";
  const d = new Date(Number(due_ts));
  return d.toLocaleString("ru-RU");
}

module.exports = async (req, res) => {
  try {
    await ensureSchema();

    // allow GET/POST for cron pings
    const nowMs = Date.now();

    // Find tasks to warn: due in next 60 minutes and not sent warning
    const warnWindowMs = 60 * 60 * 1000;

    const warnTasks = await query(
      `
      SELECT t.id, t.title, t.due_ts, t.user_id, t.assigned_to_user_id
      FROM tasks t
      LEFT JOIN task_notifications n ON n.task_id = t.id
      WHERE t.is_done = false
        AND t.due_ts IS NOT NULL
        AND t.due_ts <= $1
        AND t.due_ts >= $2
        AND COALESCE(n.sent_due_warning, false) = false
      ORDER BY t.due_ts ASC
      LIMIT 200
      `,
      [nowMs + warnWindowMs, nowMs]
    );

    // Find tasks overdue: due_ts < now and not sent overdue
    const overdueTasks = await query(
      `
      SELECT t.id, t.title, t.due_ts, t.user_id, t.assigned_to_user_id
      FROM tasks t
      LEFT JOIN task_notifications n ON n.task_id = t.id
      WHERE t.is_done = false
        AND t.due_ts IS NOT NULL
        AND t.due_ts < $1
        AND COALESCE(n.sent_overdue, false) = false
      ORDER BY t.due_ts ASC
      LIMIT 200
      `,
      [nowMs]
    );

    // helper: send to tg_id of a user_id
    async function sendToUser(user_id, text) {
      // Here we assume telegram chat_id == tg_id (common for direct bot chats)
      const u = await query(`SELECT tg_id FROM users WHERE id=$1`, [user_id]);
      const tg_id = u.rows[0]?.tg_id;
      if (!tg_id) return false;

      const focus = await getLatestFocusText(user_id);
      const fullText =
        text +
        (focus ? `\n\n<b>Твой фокус:</b> ${focus}` : "\n\n<b>Фокус:</b> (не задан)");

      await tgSendMessage(tg_id, fullText);
      return true;
    }

    let sent = 0;

    // Process warnings
    for (const t of warnTasks.rows) {
      const receiverUserId = t.assigned_to_user_id || t.user_id;

      const msg =
        `⏰ <b>Скоро дедлайн</b>\n` +
        `Задача: <b>${t.title}</b>\n` +
        `Дедлайн: ${formatDueTs(t.due_ts)}\n` +
        `\nНапиши мне сюда, если нужно: разбить на шаги / приоритезировать / сделать план.`;

      const ok = await sendToUser(receiverUserId, msg);

      // mark notification
      await query(
        `
        INSERT INTO task_notifications (task_id, sent_due_warning, sent_overdue, updated_at)
        VALUES ($1, true, false, now())
        ON CONFLICT (task_id) DO UPDATE
          SET sent_due_warning = true,
              updated_at = now()
        `,
        [t.id]
      );

      if (ok) sent += 1;
    }

    // Process overdue
    for (const t of overdueTasks.rows) {
      const receiverUserId = t.assigned_to_user_id || t.user_id;

      const msg =
        `🔥 <b>Просрочено</b>\n` +
        `Задача: <b>${t.title}</b>\n` +
        `Дедлайн был: ${formatDueTs(t.due_ts)}\n` +
        `\nХочешь — помогу: что делегировать, что выкинуть, как закрыть быстро.`;

      const ok = await sendToUser(receiverUserId, msg);

      await query(
        `
        INSERT INTO task_notifications (task_id, sent_due_warning, sent_overdue, updated_at)
        VALUES ($1, false, true, now())
        ON CONFLICT (task_id) DO UPDATE
          SET sent_overdue = true,
              updated_at = now()
        `,
        [t.id]
      );

      if (ok) sent += 1;
    }

    return res.status(200).json({
      ok: true,
      sent,
      warn_count: warnTasks.rows.length,
      overdue_count: overdueTasks.rows.length,
    });
  } catch (e) {
    console.error("cron/notify error:", e);
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
};
