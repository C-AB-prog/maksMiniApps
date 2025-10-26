// /api/[...slug].js
const { json, readBody, getUser } = require('./_utils');
const db = require('./_db');

// один хэндлер на всё
module.exports = async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);

  try {
    const me = getUser(req, res); // кука пользователю (без БД)

    // --- DEBUG --------------------------------------------------------------
    if (parts[0] === 'debug') {
      const what = url.searchParams.get('what') || 'ping';
      if (what === 'ping') return json(res, { ok: true, now: new Date().toISOString() });

      if (what === 'conn') {
        const p = db.pool; // ленивое создание пула
        const r = await p.query('select current_user, current_database(), version()');
        return json(res, {
          ok: true,
          info: { user: r.rows[0].current_user, db: r.rows[0].current_database, version: r.rows[0].version }
        });
      }

      if (what === 'schema') {
        await db.ensureSchema();
        const p = db.pool;
        const tables = await p.query(`
          select table_schema||'.'||table_name as tbl
          from information_schema.tables
          where table_schema='public' and table_name in ('users','tasks','focus')
          order by table_name`);
        return json(res, { ok: true, tables: tables.rows.map(r => r.tbl) });
      }

      return json(res, { ok: false, msg: 'debug: unknown what' }, 400);
    }

    // --- HEALTH -------------------------------------------------------------
    if (parts[0] === 'health') {
      await db.ensureSchema();
      await db.pool.query('select 1');
      return json(res, { ok: true, db: 'ok' });
    }

    // --- FOCUS --------------------------------------------------------------
    if (parts[0] === 'focus') {
      const p = db.pool;
      await db.upsertUser(me);
      if (req.method === 'GET') {
        const r = await p.query('select text, updated_at from focus where user_id=$1', [me.id]);
        return json(res, r.rows[0] || {});
      }
      if (req.method === 'PUT') {
        const body = await readBody(req);
        const text = String(body.text || '').trim();
        if (!text) return json(res, { error: 'empty text' }, 400);
        await p.query(
          `insert into focus(user_id, text, updated_at) values($1,$2,now())
           on conflict (user_id) do update set text=excluded.text, updated_at=now()`,
          [me.id, text]
        );
        return json(res, { ok: true });
      }
      return json(res, { error: 'method not allowed' }, 405);
    }

    // --- TASKS --------------------------------------------------------------
    if (parts[0] === 'tasks') {
      const p = db.pool;
      await db.upsertUser(me);

      if (req.method === 'GET') {
        const r = await p.query('select * from tasks where user_id=$1 order by created_at desc limit 200', [me.id]);
        return json(res, { tasks: r.rows });
      }

      if (req.method === 'POST') {
        const body = await readBody(req);
        const title = String(body.title || '').trim();
        if (!title) return json(res, { error: 'empty title' }, 400);
        const scope = body.scope || 'today';
        const due_at = body.due_at ? new Date(body.due_at) : null;
        await p.query(
          `insert into tasks(user_id, title, scope, due_at) values($1,$2,$3,$4)`,
          [me.id, title, scope, due_at]
        );
        return json(res, { ok: true });
      }

      if (req.method === 'PUT' && parts[1]) {
        const body = await readBody(req);
        const id = Number(parts[1]);
        if ('done' in body) {
          await p.query(`update tasks set done=$1 where id=$2 and user_id=$3`, [!!body.done, id, me.id]);
          return json(res, { ok: true });
        }
        if ('title' in body) {
          await p.query(`update tasks set title=$1 where id=$2 and user_id=$3`, [String(body.title), id, me.id]);
          return json(res, { ok: true });
        }
        return json(res, { error: 'nothing to update' }, 400);
      }

      if (req.method === 'DELETE' && parts[1]) {
        const id = Number(parts[1]);
        await p.query(`delete from tasks where id=$1 and user_id=$2`, [id, me.id]);
        return json(res, { ok: true });
      }

      return json(res, { error: 'method not allowed' }, 405);
    }

    // --- CHAT (ленивый import openai) --------------------------------------
    if (parts[0] === 'chat' && req.method === 'POST') {
      const body = await readBody(req);
      const q = String(body.q || '').trim();
      if (!q) return json(res, { error: 'empty question' }, 400);

      // чтобы модуль openai не ломал всё, если его нет
      const { OpenAI } = require('openai');
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const r = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: q }]
      });
      return json(res, { a: r.choices[0].message.content.trim() });
    }

    // --- not found ----------------------------------------------------------
    return json(res, { error: 'not found' }, 404);
  } catch (e) {
    // ВАЖНО: всегда отдаём JSON с текстом и стеком — увидим истинную причину
    return json(res, {
      ok: false,
      error: String(e && e.message || e),
      stack: e && e.stack
    }, 500);
  }
};
