// api/chat-store.js
// Раньше тут был "снапшот" чатов через несуществующий lib/db и таблицу chat_threads.
// Сейчас — безопасно выключено (не используется твоим index.html).

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(410).json({
    ok: false,
    error: "deprecated",
    note: "This endpoint is deprecated. Use /api/chat_sessions and /api/chat_history.",
  });
}
