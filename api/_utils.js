// /api/_utils.js
import { q } from "./_db.js";

// Telegram initData находится в хедере 'x-telegram-init-data' (так делает твой фронт)
export function parseTelegramInitData(req) {
  const raw = req.headers.get("x-telegram-init-data") || "";
  // initData — это querystring. Ищем параметр user
  const userPart = raw.split("&").find(p => p.startsWith("user="));
  if (!userPart) return null;
  try {
    const json = decodeURIComponent(userPart.split("=", 2)[1]);
    const u = JSON.parse(json);
    return {
      tg_id: Number(u.id),
      username: u.username || null,
      first_name: u.first_name || null,
      last_name: u.last_name || null,
    };
  } catch {
    return null;
  }
}

export async function ensureUser(req) {
  const tgu = parseTelegramInitData(req);
  if (!tgu || !tgu.tg_id) {
    // можно вернуть null — фронт покажет тост «Открой через Telegram»
    return null;
  }

  // upsert по tg_id
  const r = await q(
    `
      INSERT INTO users (tg_id, username, first_name, last_name)
      VALUES ($1,$2,$3,$4)
      ON CONFLICT (tg_id) DO UPDATE
      SET username = EXCLUDED.username,
          first_name = EXCLUDED.first_name,
          last_name = EXCLUDED.last_name
      RETURNING id, tg_id, username, first_name, last_name;
    `,
    [tgu.tg_id, tgu.username, tgu.first_name, tgu.last_name]
  );
  return r.rows[0];
}

// обычный json-ответ
export function json(data, init = 200) {
  const status = typeof init === "number" ? init : init?.status || 200;
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

// разбор URL
export function parseUrl(req) {
  return new URL(req.url, "http://x");
}
