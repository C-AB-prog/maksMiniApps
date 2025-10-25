const { getOrCreateUser, readJSON, sendJSON } = require('../_utils');
const { pool, ensureSchema, upsertUser } = require('../_db');

module.exports = async (req,res)=>{
  try{
    if(!['GET','POST'].includes(req.method)){ res.setHeader('Allow','GET, POST'); return sendJSON(res,405,{error:'Method Not Allowed'}); }
    const qs = (()=>{ try{ return new URL(req.url,'http://x').searchParams }catch{ return new URLSearchParams() } })();
    const tz = qs.get('tz') || null;

    const { user } = getOrCreateUser(req,res);
    await ensureSchema(); await upsertUser(user, tz);

    if(req.method==='GET'){
      const { rows } = await pool.query(
        `SELECT id,user_id,parent_id,title,notes,scope,priority,done,due_at,remind_at,created_at,updated_at
           FROM tasks WHERE user_id=$1 ORDER BY created_at DESC`,
        [user.id]
      );
      return sendJSON(res,200,{ tasks: rows });
    }

    const b = await readJSON(req);
    const title = String(b.title||'').trim().slice(0,500);
    if(!title) return sendJSON(res,400,{error:'TITLE_REQUIRED'});
    const parent_id = b.parent_id ? Number(b.parent_id) : null;
    const notes = b.notes ? String(b.notes).slice(0,4000) : null;
    const scope = (['today','week','backlog'].includes(b.scope) ? b.scope : 'today');
    const priority = Number.isFinite(b.priority) ? Math.max(-999, Math.min(999, Number(b.priority))) : 0;
    const due_at = b.due_at ? new Date(b.due_at) : null;
    const remind_at = b.remind_at ? new Date(b.remind_at) : null;

    const { rows } = await pool.query(
      `INSERT INTO tasks (user_id,parent_id,title,notes,scope,priority,due_at,remind_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id,user_id,parent_id,title,notes,scope,priority,done,due_at,remind_at,created_at,updated_at`,
      [user.id, parent_id, title, notes, scope, priority, due_at, remind_at]
    );
    return sendJSON(res,200, rows[0]);
  }catch(e){ return sendJSON(res,500,{error:e.message}); }
};
