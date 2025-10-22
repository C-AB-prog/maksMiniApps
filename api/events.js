// api/events.js
import { sql } from "@vercel/postgres";
import { ensureSchema, getOrCreateUserByTelegram } from "./_utils/db.js";
import { verifyTelegramInitNode, parseTelegramUser } from "./_utils/tg_node.js";
import crypto from "crypto";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET" && req.method !== "POST") {
      res.status(405).json({ error: "Use GET or POST" });
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
      const q = await sql/*sql*/`
        SELECT id, title, day, start, dur FROM events
        WHERE user_id=${userId} AND day=${day}
        ORDER BY start ASC;
      `;
      res.status(200).json({ items: q.rows });
      return;
    }

    if (req.method === "POST") {
      const body = await readBody(req);
      const title = (body.title || "").trim();
      const day = body.day || null;   // YYYY-MM-DD
      const start = body.start || null; // HH:MM
      const dur = body.dur || 60;

      if (!title || !day || !start) {
        res.status(400).json({ error: "TITLE_DAY_START_REQUIRED" });
        return;
      }

      const id = crypto.randomUUID();
      await sql/*sql*/`
        INSERT INTO events (id, user_id, title, day, start, dur)
        VALUES (${id}, ${userId}, ${title}, ${day}, ${start}, ${dur});
      `;
      res.status(201).json({ id, title, day, start, dur });
      return;
    }
  } catch (e) {
    console.error("events error:", e);
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
