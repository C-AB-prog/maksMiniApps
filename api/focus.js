// api/focus.js
import { sql } from "@vercel/postgres";
import { ensureSchema, getOrCreateUserByTelegram } from "./_utils/db.js";
import { verifyTelegramInitNode, parseTelegramUser } from "./_utils/tg_node.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET" && req.method !== "PUT") {
      res.status(405).json({ error: "Use GET or PUT" });
      return;
    }

    const initData = req.headers["x-telegram-init"] || req.headers["X-Telegram-Init"];
    const botToken = process.env.BOT_TOKEN || "";
    if (!verifyTelegramInitNode(initData || "", botToken)) {
      res.status(401).json({ error: "INVALID_TELEGRAM_SIGNATURE" });
      return;
    }
    await ensureSchema();

    const user = parseTelegramUser(initData || "");
    const userId = await getOrCreateUserByTelegram(user);

    const url = new URL(req.url, "http://localhost");
    const day = url.searchParams.get("day");

    if (req.method === "GET") {
      if (!day) { res.status(400).json({ error: "DAY_REQUIRED" }); return; }
      const q = await sql/*sql*/`SELECT text FROM focus WHERE user_id=${userId} AND day=${day};`;
      res.status(200).json(q.rows[0] || { text: null, day });
      return;
    }

    if (req.method === "PUT") {
      const body = await readBody(req);
      const putDay = body.day || new Date().toISOString().slice(0, 10);
      const text = (body.text || "").trim();
      if (!text) { res.status(400).json({ error: "TEXT_REQUIRED" }); return; }

      await sql/*sql*/`
        INSERT INTO focus (user_id, day, text)
        VALUES (${userId}, ${putDay}, ${text})
        ON CONFLICT (user_id, day) DO UPDATE SET text = EXCLUDED.text;
      `;
      res.status(200).json({ day: putDay, text });
      return;
    }
  } catch (e) {
    console.error("focus error:", e);
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try { resolve(JSON.parse(data || "{}")); } catch { resolve({}); }
    });
  });
}
