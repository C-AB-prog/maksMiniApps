const { getUserFromReq, sendJSON, setSessionCookie, signSession, SESSION_TTL_SEC } = require('./_utils');
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SESSION_SECRET = process.env.SESSION_SECRET || BOT_TOKEN || 'dev_secret';

module.exports = async (req,res)=>{
  const auth = await getUserFromReq(req, BOT_TOKEN);
  if(!auth.ok) return sendJSON(res, auth.status, { error:auth.error, reason:auth.reason, hasInit:auth.hasInit||false });
  if(auth.source!=='cookie'){ const now=Math.floor(Date.now()/1000); const tok=signSession({user:auth.user,iat:now,exp:now+SESSION_TTL_SEC}, SESSION_SECRET); setSessionCookie(res,tok); }
  return sendJSON(res,200,{ ok:true, user:auth.user, source:auth.source });
};
