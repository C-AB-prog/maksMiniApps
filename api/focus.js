const { getUserFromReq, sendJSON, setSessionCookie, signSession, SESSION_TTL_SEC } = require('./_utils');
const { pool, ensureSchema, upsertUser } = require('./_db');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SESSION_SECRET = process.env.SESSION_SECRET || BOT_TOKEN || 'dev_secret';

module.exports = async (req,res)=>{
  try{
    if(!['GET','PUT'].includes(req.method)){ res.setHeader('Allow','GET, PUT'); return sendJSON(res,405,{error:'Method Not Allowed'}); }
    const auth = await getUserFromReq(req, BOT_TOKEN);
    if(!auth.ok) return sendJSON(res, auth.status, { error:auth.error, reason:auth.reason });
    if(auth.source !== 'cookie'){ const now=Math.floor(Date.now()/1000); const tok=signSession({user:auth.user,iat:now,exp:now+SESSION_TTL_SEC}, SESSION_SECRET); setSessionCookie(res,tok); }

    await ensureSchema(); await upsertUser(auth.user);

    if(req.method==='GET'){
      const { rows } = await pool.query(`SELECT text, updated_at FROM focus WHERE user_id=$1`, [auth.user.id]);
      return sendJSON(res,200, rows[0] || { text:'', updated_at:null });
    }

    const chunks=[]; for await(const ch of req) chunks.push(ch);
    const body = JSON.parse(Buffer.concat(chunks).toString()||'{}');
    const text = String(body.text||'').slice(0,2000);
    const { rows } = await pool.query(
      `INSERT INTO focus (user_id,text,updated_at) VALUES ($1,$2,now())
       ON CONFLICT (user_id) DO UPDATE SET text=EXCLUDED.text, updated_at=now()
       RETURNING text, updated_at`,
      [auth.user.id, text]
    );
    return sendJSON(res,200, rows[0]);
  }catch(e){ return sendJSON(res,500,{error:e.message}); }
};
