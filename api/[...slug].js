// /api/[...slug].js
const { pool, ensureSchema, upsertUser } = require('./_db');
const { json, getUser, readBody } = require('./_utils');

const schemaReady = ensureSchema(); // выполняем один раз на холодном старте

module.exports = async (req, res) => {
  try {
    await schemaReady;

    const me = getUser(req, res);
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname.replace(/^\/api\/?/, '');
    const parts = pathname.split('/').filter(Boolean);

    // ---------- health ----------
    if (parts[0] === 'health') {
      try {
        await pool.query('select 1');
        return json(res, { ok: true, db: 'ok' });
      } catch (e) {
        return json(res, { ok: false, error: String(e.message || e) }, 500);
      }
    }

    // ---------- debug ----------
    if (parts[0] === 'debug') {
      const what = url.searchParams.get('what') || 'ping';
      if (what === 'ping') return json(res, { ok: true, pong: Date.now() });
      if (what === 'conn') {
        try {
          await pool.query('select 1');
          return json(res, { ok: true });
        } catch (e) {
          return json(res, { ok: false, error: String(e.message || e) }, 500);
        }
      }
      if (what === 'schema') {
        const r1 = await pool.query(`
          select table_name, column_name, data_type
          from information_schema.columns
          where table_schema='public'
          order by table_name, ordinal_position
        `);
        return json(res, { ok: true, columns: r1.rows });
      }
      return json(res, { ok: true, note: 'ping|conn|schema' });
    }

    // ---------- focus ----------
    if (parts[0] === 'focus') {
      await upsertUser(me);

      if (req.method === 'GET') {
        const r = await pool.query(
          `select text, updated_at from focus where user_id=$1`,
          [me.id]
        );
        return json(res, r.rowCount ? r.rows[0] : {});
      }

      if (req.method === 'PUT') {
        const body = await readBody(req);
        const text = (body.text || '').toString();
        await pool.query(
          `insert into focus(user_id, text, updated_at)
             values($1,$2, now())
           on conflict (user_id) do update
             set text=excluded.text, updated_at=now()`,
          [me.id, text]
        );
        return json(res, { ok: true });
      }

      return json(res, { error: 'method not allowed' }, 405);
    }

    // ---------- tasks ----------
    if (parts[0] === 'tasks') {
      await upsertUser(me);

      if (req.method === 'GET') {
        const r = await pool.query(
          'select * from tasks where user_id=$1 order by created_at desc limit 200',
          [me.id]
        );
        return json(res, { tasks: r.rows });
      }

      if (req.method === 'POST') {
        const body = await readBody(req);
        const title = String(body.title || '').trim();
        if (!title) return json(res, { error: 'empty title' }, 400);

        const scope = body.scope || 'today';
        const due_at = body.due_at ? new Date(body.due_at) : null;

        await pool.query(
          `insert into tasks(user_id, title, scope, due_at)
             values($1,$2,$3,$4)`,
          [me.id, title, scope, due_at]
        );
        return json(res, { ok: true });
      }

      // ✅ id может прийти: /tasks/:id ИЛИ ?id= ИЛИ в body.id
      if (req.method === 'PUT') {
        let id = parts[1] || url.searchParams.get('id');
        const body = await readBody(req);
        if (!id) id = body.id;
        id = Number(id);
        if (!id) return json(res, { error: 'missing id' }, 400);

        if ('done' in body) {
          await pool.query(
            `update tasks set done=$1 where id=$2 and user_id=$3`,
            [!!body.done, id, me.id]
          );
          return json(res, { ok: true });
        }
        if ('title' in body) {
          await pool.query(
            `update tasks set title=$1 where id=$2 and user_id=$3`,
            [String(body.title), id, me.id]
          );
          return json(res, { ok: true });
        }
        return json(res, { error: 'nothing to update' }, 400);
      }

      if (req.method === 'DELETE') {
        let id = parts[1] || url.searchParams.get('id');
        if (!id) {
          const body = await readBody(req);
          id = body.id;
        }
        id = Number(id);
        if (!id) return json(res, { error: 'missing id' }, 400);

        await pool.query(`delete from tasks where id=$1 and user_id=$2`, [id, me.id]);
        return json(res, { ok: true });
      }

      return json(res, { error: 'method not allowed' }, 405);
    }

    // ---------- chat (простая заглушка; если нужен OpenAI — добавим позже) ----------
    if (parts[0] === 'chat') {
      const body = await readBody(req);
      const q = (body.q || '').toString().trim();
      const a = q ? `Вы спросили: «${q}». Пока даю базовый ответ 🙂` : 'Спросите что-нибудь.';
      return json(res, { a });
    }

    // fallback
    return json(res, { error: 'not found', path: parts }, 404);
  } catch (e) {
    return json(res, { ok: false, error: String(e.message || e) }, 500);
  }
};
