// api/tasks/index.js
import { sql } from "@vercel/postgres";
import { ensureSchema, getOrCreateUserByTelegram } from "../_utils/db.js";
import { verifyTelegramInitNode, parseTelegramUser } from "../_utils/tg_node.js";
import crypto from "crypto";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET" && req.method !== "POST") {
      res.status(405).json({ error: "Use GET or POST" });
      return;
    }

    // Telegram auth
    const initData = req.headers["x-telegram-init"] || req.headers["X-Telegram-Init"];
    const botToken = process.env.BOT_TOKEN || "";
    if (!verifyTelegramInitNode(initData || "", botToken)) {
      res.status(401).json({ error: "INVALID_TELEGRAM_SIGNATURE" });
      return;
    }
    await ensureSchema();

    const user = parseTelegramUser(initData || "");
    const userId = await getOrCreateUserByTelegram(user);

    // Parse query
    const url = new URL(req.url, "http://localhost");
    const listParam = url.searchParams.get("list"); // today|week|backlog|null

    if (req.method === "GET") {
      let q;
      if (listParam) {
        q = await sql/*sql*/`
          SELECT id, title, list, due_date, due_time, done
          FROM tasks
          WHERE user_id = ${userId} AND list = ${listParam}
          ORDER BY created_at DESC;
        `;
      } else {
        q = await sql/*sql*/`
          SELECT id, title, list, due_date, due_time, done
          FROM tasks
          WHERE user_id = ${userId}
          ORDER BY created_at DESC;
        `;
      }
      res.status(200).json({ items: q.rows });
      return;
    }

    if (req.method === "POST") {
      const body = await readBody(req);
      const title = (body.title || "").trim();
      const list = body.list || "today";
      const due_date = body.due_date || null; // YYYY-MM-DD
      const due_time = body.due_time || null; // HH:MM

      if (!title) {
        res.status(400).json({ error: "TITLE_REQUIRED" });
        return;
      }
      if (!["today", "week", "backlog"].includes(list)) {
        res.status(400).json({ error: "BAD_LIST" });
        return;
      }

      const id = crypto.randomUUID();
      await sql/*sql*/`
        INSERT INTO tasks (id, user_id, title, list, due_date, due_time)
        VALUES (${id}, ${userId}, ${title}, ${list}, ${due_date}, ${due_time});
      `;

      res.status(201).json({ id, title, list, due_date, due_time, done: false });
      return;
    }
  } catch (e) {
    console.error("tasks/index error:", e);
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
