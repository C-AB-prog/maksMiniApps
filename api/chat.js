const { getUserFromReq, sendJSON, setSessionCookie, signSession, SESSION_TTL_SEC } = require('./_utils');
const { ensureSchema, upsertUser } = require('./_db');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SESSION_SECRET = process.env.SESSION_SECRET || BOT_TOKEN || 'dev_secret';

module.exports = async (req,res)=>{
  try{
    if(req.method!=='POST'){ res.setHeader('Allow','POST'); return sendJSON(res,405,{error:'Method Not Allowed'}); }
    const auth = await getUserFromReq(req, BOT_TOKEN);
    if(!auth.ok) return sendJSON(res, auth.status, { error:auth.error, reason:auth.reason });
    if(auth.source !== 'cookie'){ const now=Math.floor(Date.now()/1000); const tok=signSession({user:auth.user,iat:now,exp:now+SESSION_TTL_SEC}, SESSION_SECRET); setSessionCookie(res,tok); }

    await ensureSchema(); await upsertUser(auth.user);

    const chunks=[]; for await(const ch of req) chunks.push(ch);
    const body = JSON.parse(Buffer.concat(chunks).toString()||'{}');
    const q = String(body.q||'').trim();
    const a = q ? `Вы спросили: “${q}”. Я пока в режиме подсказок по фокусу/задачам.` : 'Спросите про фокус или задачи.';
    return sendJSON(res,200,{ a });
  }catch(e){ return sendJSON(res,500,{error:e.message}); }
};
