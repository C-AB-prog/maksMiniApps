// /api/[...slug].js
exports.config = { runtime: 'nodejs20.x' };

const { pool, ensureSchema, upsertUser } = require('./_db');
const { sendJSON, readJSON, getOrCreateUser } = require('./_utils');

function pathOf(req) {
  const u = new URL(req.url, 'http://x');
  return u.pathname.replace(/^\/api\//, ''); // 'tasks', 'tasks/123', 'focus', ...
}
function idFromPath(p) {
  const parts = p.split('/');
  const raw = parts[1];
  const id = Number(raw);
  return Number.isFinite(id) ? id : null;
}
function parseISOorNull(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d) ? null : d.toISOString();
}

async function handleHealth(_req, res) {
  try {
    await ensureSchema();
    await pool.query('select 1');
    return sendJSON(res, 200, { ok: true, db: 'ok' });
  } catch (e) {
    return sendJSON(res, 500, { ok: false, error: e.message || String(e) });
  }
}

async function handleWhoami(req, res) {
  try {
    const { user, source } = getOrCreateUser(req, res);
    return sendJSON(res, 200, { source, user });
  } catch (e) {
    return sendJSON(res, e.status || 500, { error: e.message });
  }
}

async function handleFocus(req, res) {
  try {
    const { user } = getOrCreateUser(req, res);
    await ensureSchema();

    if (req.method === 'GET') {
      const r = await pool.query('select text, updated_at from focus where user_id=$1', [user.id]);
      const row = r.rows[0] || null;
      return sendJSON(res, 200, row || {});
    }

    if (req.method === 'PUT') {
      const b = await readJSON(req);
      const text = String(b.text || '').trim();
      if (!text) return sendJSON(res, 400, { error: 'EMPTY' });
      await upsertUser(user);
      await pool.query(
        `insert into focus(user_id, text, updated_at)
         values ($1,$2,now())
         on conflict (user_id)
         do update set text=excluded.text, updated_at=now()`,
        [user.id, text]
      );
      return sendJSON(res, 200, { ok: true });
    }

    res.setHeader('Allow', 'GET, PUT');
    return sendJSON(res, 405, { error: 'Method Not Allowed' });
  } catch (e) {
    return sendJSON(res, 500, { error: e.message || String(e) });
  }
}

async function handleTasksCollection(req, res) {
  try {
    const { user } = getOrCreateUser(req, res);
    await ensureSchema();

    if (req.method === 'GET') {
      const r = await pool.query(
        `select id, title, scope, done, due_at, priority, created_at
         from tasks where user_id=$1
         order by done asc, coalesce(due_at, now() + interval '100 years') asc, id desc`,
        [user.id]
      );
      return sendJSON(res, 200, { tasks: r.rows });
    }

    if (req.method === 'POST') {
      const b = await readJSON(req);
      const title = String(b.title || '').trim();
      if (!title) return sendJSON(res, 400, { error: 'EMPTY' });
      const scope = ['today','week','backlog'].includes(b.scope) ? b.scope : 'today';
      const due_at = parseISOorNull(b.due_at);
      const priority = Number.isFinite(+b.priority) ? +b.priority : 0;

      await upsertUser(user);
      await pool.query(
        `insert into tasks(user_id, title, scope, done, due_at, priority)
         values ($1,$2,$3,false,$4,$5)`,
        [user.id, title, scope, due_at, priority]
      );
      return sendJSON(res, 200, { ok: true });
    }

    res.setHeader('Allow', 'GET, POST');
    return sendJSON(res, 405, { error: 'Method Not Allowed' });
  } catch (e) {
    return sendJSON(res, 500, { error: e.message || String(e) });
  }
}

async function handleTaskItem(req, res, id) {
  try {
    const { user } = getOrCreateUser(req, res);
    await ensureSchema();

    if (req.method === 'PUT') {
      const b = await readJSON(req);
      if (typeof b.done === 'boolean') {
        await pool.query(`update tasks set done=$1 where id=$2 and user_id=$3`, [b.done, id, user.id]);
        return sendJSON(res, 200, { ok: true });
      }
      const title = b.title != null ? String(b.title).trim() : null;
      const scope = b.scope && ['today','week','backlog'].includes(b.scope) ? b.scope : null;
      const due_at = parseISOorNull(b.due_at);
      const remind_at = parseISOorNull(b.remind_at);
      const priority = Number.isFinite(+b.priority) ? +b.priority : null;
      const notes = b.notes != null ? String(b.notes).slice(0,2000) : null;

      await pool.query(
        `update tasks set
           title = coalesce($1, title),
           scope = coalesce($2, scope),
           due_at = coalesce($3, due_at),
           remind_at = coalesce($4, remind_at),
           priority = coalesce($5, priority),
           notes = coalesce($6, notes)
         where id=$7 and user_id=$8`,
        [title, scope, due_at, remind_at, priority, notes, id, user.id]
      );
      return sendJSON(res, 200, { ok: true });
    }

    if (req.method === 'DELETE') {
      await pool.query(`delete from tasks where id=$1 and user_id=$2`, [id, user.id]);
      return sendJSON(res, 200, { ok: true });
    }

    res.setHeader('Allow', 'PUT, DELETE');
    return sendJSON(res, 405, { error: 'Method Not Allowed' });
  } catch (e) {
    return sendJSON(res, 500, { error: e.message || String(e) });
  }
}

async function handleChat(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return sendJSON(res, 405, { error: 'Method Not Allowed' });
    }
    const { user } = getOrCreateUser(req, res);
    await upsertUser(user);

    const b = await readJSON(req);
    const q = String(b.q || '').trim();
    if (!q) return sendJSON(res, 400, { error: 'EMPTY' });

    const key = process.env.OPENAI_API_KEY || '';
    if (!key) {
      return sendJSON(res, 200, { a: 'LLM не подключён. Добавь OPENAI_API_KEY в Vercel → Settings → Environment Variables.' });
    }

    const OpenAI = require('openai');
    const openai = new OpenAI({ apiKey: key });

    const r = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Ты помогаешь ставить фокус дня, раскладывать задачи и приоритизировать. Отвечай кратко и по делу.' },
        { role: 'user', content: q }
      ],
      temperature: 0.5
    });

    const text = r.choices?.[0]?.message?.content?.trim() || '…';
    return sendJSON(res, 200, { a: text });
  } catch (e) {
    return sendJSON(res, 500, { error: e.message || String(e) });
  }
}

module.exports = async (req, res) => {
  const p = pathOf(req);            // e.g. 'tasks', 'tasks/123', 'focus'
  try {
    if (p === 'health')   return handleHealth(req, res);
    if (p === 'whoami')   return handleWhoami(req, res);
    if (p === 'focus')    return handleFocus(req, res);
    if (p === 'tasks')    return handleTasksCollection(req, res);
    if (p.startsWith('tasks/')) {
      const id = idFromPath(p);
      if (!id) return sendJSON(res, 400, { error: 'BAD_ID' });
      return handleTaskItem(req, res, id);
    }
    if (p === 'chat')     return handleChat(req, res);

    return sendJSON(res, 404, { error: 'Not Found', path: p });
  } catch (e) {
    return sendJSON(res, 500, { error: e.message || String(e) });
  }
};
