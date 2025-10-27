// /api/tasks.js
import { ensureSchema, q } from "./_db.js";
import { ensureUser, json, parseUrl } from "./_utils.js";

function pickIdFromPath(url) {
  // /api/tasks/123 -> 123; /api/tasks -> null
  const parts = url.pathname.split("/").filter(Boolean);
  const last = parts[parts.length - 1];
  return parts.length >= 3 && parts[parts.length - 2] === "tasks" ? Number(last) : null;
}

export async function GET(req) {
  try {
    await ensureSchema();
    const user = await ensureUser(req);
    if (!user) return json({ error: "open_via_telegram" }, 401);

    const r = await q(
      `SELECT id, title, scope, due_at, done
       FROM tasks
       WHERE user_id=$1
       ORDER BY done ASC, due_at NULLS LAST, created_at DESC`,
      [user.id]
    );
    return json({ tasks: r.rows });
  } catch (e) {
    return json({ error: String(e.message || e) }, 500);
  }
}

export async function POST(req) {
  try {
    await ensureSchema();
    const user = await ensureUser(req);
    if (!user) return json({ error: "open_via_telegram" }, 401);

    const body = await req.json().catch(() => ({}));
    const title = String(body.title || "").trim();
    if (!title) return json({ error: "empty" }, 400);

    const scope = ["today", "week", "backlog"].includes(body.scope) ? body.scope : "today";
    const due_at = body.due_at ? new Date(body.due_at) : null;

    const r = await q(
      `INSERT INTO tasks (user_id, title, scope, due_at)
       VALUES ($1,$2,$3,$4)
       RETURNING id, title, scope, due_at, done`,
      [user.id, title, scope, due_at]
    );
    return json({ task: r.rows[0] });
  } catch (e) {
    return json({ error: String(e.message || e) }, 500);
  }
}

export async function PUT(req) {
  try {
    await ensureSchema();
    const user = await ensureUser(req);
    if (!user) return json({ error: "open_via_telegram" }, 401);

    const url = parseUrl(req);
    const id = pickIdFromPath(url);
    const body = await req.json().catch(() => ({}));

    if (!id) {
      // массовые обновления здесь не делаем
      return json({ error: "no_id" }, 400);
    }

    // разрешаем обновлять только поле done
    const done = body.done === true;

    const r = await q(
      `UPDATE tasks SET done=$1 WHERE id=$2 AND user_id=$3 RETURNING id`,
      [done, id, user.id]
    );
    if (r.rowCount === 0) return json({ error: "not_found" }, 404);

    return json({ ok: true });
  } catch (e) {
    return json({ error: String(e.message || e) }, 500);
  }
}

export async function DELETE(req) {
  try {
    await ensureSchema();
    const user = await ensureUser(req);
    if (!user) return json({ error: "open_via_telegram" }, 401);

    const url = parseUrl(req);
    const id = pickIdFromPath(url);
    if (!id) return json({ error: "no_id" }, 400);

    const r = await q(`DELETE FROM tasks WHERE id=$1 AND user_id=$2`, [id, user.id]);
    if (r.rowCount === 0) return json({ error: "not_found" }, 404);

    return json({ ok: true });
  } catch (e) {
    return json({ error: String(e.message || e) }, 500);
  }
}
