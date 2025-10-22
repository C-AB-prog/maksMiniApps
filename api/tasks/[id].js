// api/tasks/[id].js
import { sql } from "@vercel/postgres";
import { ensureSchema, getOrCreateUserByTelegram } from "../_utils/db.js";
import { verifyTelegramInitNode, parseTelegramUser } from "../_utils/tg_node.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "PATCH" && req.method !== "DELETE") {
      res.status(405).json({ error: "Use PATCH or DELETE" });
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

    const id = extractId(req.url);
    if (!id) {
      res.status(400).json({ error: "BAD_ID" });
      return;
    }

    if (req.method === "DELETE") {
      await sql/*sql*/`DELETE FROM tasks WHERE id = ${id} AND user_id = ${userId};`;
      res.status(200).json({ ok: true });
      return;
    }

    if (req.method === "PATCH") {
      const body = await readBody(req);

      // Патчим по полям — простыми запросами (MVP)
      if ("title" in body) {
        await sql/*sql*/`UPDATE tasks SET title = ${body.title} WHERE id = ${id} AND user_id = ${userId};`;
      }
      if ("list" in body) {
        const lst = body.list;
        if (["today", "week", "backlog"].includes(lst)) {
          await sql/*sql*/`UPDATE tasks SET list = ${lst} WHERE id = ${id} AND user_id = ${userId};`;
        }
      }
      if ("due_date" in body) {
        await sql/*sql*/`UPDATE tasks SET due_date = ${body.due_date || null} WHERE id = ${id} AND user_id = ${userId};`;
      }
      if ("due_time" in body) {
        await sql/*sql*/`UPDATE tasks SET due_time = ${body.due_time || null} WHERE id = ${id} AND user_id = ${userId};`;
      }
      if ("done" in body) {
        await sql/*sql*/`UPDATE tasks SET done = ${!!body.done} WHERE id = ${id} AND user_id = ${userId};`;
      }

      const q = await sql/*sql*/`SELECT id, title, list, due_date, due_time, done FROM tasks WHERE id = ${id} AND user_id = ${userId};`;
      res.status(200).json(q.rows[0] || null);
      return;
    }
  } catch (e) {
    console.error("tasks/[id] error:", e);
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
}

function extractId(url) {
  try {
    const u = new URL(url, "http://localhost");
    const parts = u.pathname.split("/"); // /api/tasks/<id>
    return parts[parts.length - 1] || null;
  } catch { return null; }
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
