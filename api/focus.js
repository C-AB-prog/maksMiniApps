const { getOrCreateUser, readJSON, sendJSON } = require('./_utils');
const { pool, ensureSchema, upsertUser } = require('./_db');

module.exports = async (req,res)=>{
  try{
    if(!['GET','PUT'].includes(req.method)){ res.setHeader('Allow','GET, PUT'); return sendJSON(res,405,{error:'Method Not Allowed'}); }
    const qs = (()=>{ try{ return new URL(req.url,'http://x').searchParams }catch{ return new URLSearchParams() } })();
    const tz = qs.get('tz') || null;

    const { user } = getOrCreateUser(req,res);
    await ensureSchema(); await upsertUser(user, tz);

    if(req.method==='GET'){
      const { rows } = await pool.query(`SELECT text, updated_at, updated_by FROM focus WHERE user_id=$1`, [user.id]);
      return sendJSON(res,200, rows[0] || { text:'', updated_at:null, updated_by:null });
    }

    const body = await readJSON(req);
    const text = String(body.text||'').slice(0, 4000);
    const updated_by = 'user'; // позже: 'llm' при подтверждённой замене

    const { rows } = await pool.query(
      `INSERT INTO focus (user_id,text,updated_at,updated_by)
       VALUES ($1,$2, now(), $3)
       ON CONFLICT (user_id) DO UPDATE SET text=EXCLUDED.text, updated_at=now(), updated_by=EXCLUDED.updated_by
       RETURNING text, updated_at, updated_by`,
      [user.id, text, updated_by]
    );
    return sendJSON(res,200, rows[0]);
  }catch(e){ return sendJSON(res,500,{error:e.message}); }
};
