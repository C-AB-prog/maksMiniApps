// api/bot/webhook.js
const OpenAI = require("openai");
const { ensureSchema, query, getOrCreateUserIdByTgId } = require("../_db");

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function tgSendMessage(chatId, text, extra = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Missing TELEGRAM_BOT_TOKEN");

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const payload = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...extra,
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
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

module.exports = async (req, res) => {
  try {
    await ensureSchema();

    // Telegram sends POST updates
    if (req.method !== "POST") {
      return res.status(200).json({ ok: true });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const msg = body?.message;

    if (!msg || !msg.chat || !msg.text) {
      return res.status(200).json({ ok: true });
    }

    const chatId = msg.chat.id;
    const text = (msg.text || "").trim();

    // /start
    if (text === "/start") {
      await tgSendMessage(
        chatId,
        "Привет! Я бизнес-ассистент. Пиши вопрос — помогу планом действий, текстами, стратегией и идеями."
      );
      return res.status(200).json({ ok: true });
    }

    // User mapping by tg_id
    const tg_id = msg.from?.id;
    if (!tg_id) {
      await tgSendMessage(chatId, "Не вижу tg_id пользователя. Попробуй ещё раз.");
      return res.status(200).json({ ok: true });
    }

    const user_id = await getOrCreateUserIdByTgId(tg_id);
    const focus = await getLatestFocusText(user_id);

    const systemPrompt = `
Ты — бизнес-ассистент: стратегия, маркетинг, продажи, продукт, процессы.
Дай чёткие шаги и варианты. Меньше воды, больше действий.
Если у пользователя есть текущий фокус — учитывай его.
    `.trim();

    const messages = [
      { role: "system", content: systemPrompt + (focus ? `\nТекущий фокус пользователя: ${focus}` : "") },
      { role: "user", content: text },
    ];

    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages,
      temperature: 0.6,
      max_tokens: 700,
    });

    const answer =
      completion?.choices?.[0]?.message?.content?.trim() ||
      "Не получилось ответить. Попробуй иначе сформулировать.";

    await tgSendMessage(chatId, answer);

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("bot/webhook error:", e);
    // Telegram expects 200 to stop retries sometimes, but Vercel ok with 200 anyway
    return res.status(200).json({ ok: true });
  }
};
