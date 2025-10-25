const { getOrCreateUser, readJSON, sendJSON } = require('../_utils');
const { pool, ensureSchema, upsertUser } = require('../_db');

module.exports = async (req,res)=>{
  try{
    const idFromUrl = (req.url||'').split('?')[0].split('/').pop();
    const taskId = Number(idFromUrl); if(!taskId) return sendJSON(res,400,{error:'BAD_ID'});
    if(!['PUT','DELETE'].includes(req.method)){ res.setHeader('Allow','PUT, DELETE'); return sendJSON(res,405,{error:'Method Not Allowed'}); }
    const qs = (()=>{ try{ return new URL(req.url,'http://x').searchParams }catch{ return new URLSearchParams() } })();
    const tz = qs.get('tz') || null;

    const { user } = getOrCreateUser(req,res);
    await ensureSchema(); await upsertUser(user, tz);

    if(req.method==='PUT'){
      const b = await readJSON(req);
      const fields=[]; const params=[]; let p=1;
      if(typeof b.done==='boolean'){ fields.push(`done=$${p++}`); params.push(b.done); }
      if(typeof b.title==='string'){ fields.push(`title=$${p++}`); params.push(String(b.title).slice(0,500)); }
      if(typeof b.notes==='string'){ fields.push(`notes=$${p++}`); params.push(String(b.notes).slice(0,4000)); }
      if(typeof b.scope==='string' && ['today','week','backlog'].includes(b.scope)){ fields.push(`scope=$${p++}`); params.push(b.scope); }
      if(Number.isFinite(b.priority)){ fields.push(`priority=$${p++}`); params.push(Math.max(-999, Math.min(999, Number(b.priority)))); }
      if(b.parent_id!==undefined){ fields.push(`parent_id=$${p++}`); params.push(b.parent_id? Number(b.parent_id): null); }
      if(b.due_at!==undefined){ fields.push(`due_at=$${p++}`); params.push(b.due_at? new Date(b.due_at): null); }
      if(b.remind_at!==undefined){ fields.push(`remind_at=$${p++}`); params.push(b.remind_at? new Date(b.remind_at): null); }
      if(!fields.length) return sendJSON(res,400,{error:'NO_FIELDS'});

      fields.push(`updated_at=now()`);
      params.push(user.id); params.push(taskId);

      const { rows } = await pool.query(
        `UPDATE tasks SET ${fields.join(', ')} WHERE user_id=$${p++} AND id=$${p}
         RETURNING id,user_id,parent_id,title,notes,scope,priority,done,due_at,remind_at,created_at,updated_at`,
        params
      );
      if(!rows[0]) return sendJSON(res,404,{error:'NOT_FOUND'});
      return sendJSON(res,200, rows[0]);
    }

    const { rowCount } = await pool.query(`DELETE FROM tasks WHERE user_id=$1 AND id=$2`, [user.id, taskId]);
    if(!rowCount) return sendJSON(res,404,{error:'NOT_FOUND'});
    res.statusCode = 204; res.end();
  }catch(e){ return sendJSON(res,500,{error:e.message}); }
};
