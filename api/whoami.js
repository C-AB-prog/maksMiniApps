// /api/whoami.js
const { getUserFromReq, sendJSON, setSessionCookie, signSession } = require('./_utils');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SESSION_SECRET = process.env.SESSION_SECRET || BOT_TOKEN || 'dev_secret';
const SESSION_TTL_SEC = 60 * 60 * 24 * 30;

module.exports = async (req,res)=>{
  const auth = await getUserFromReq(req, BOT_TOKEN);
  if (!auth.ok) return sendJSON(res, auth.status, {
    error: auth.error, reason: auth.reason, hasInit: auth.hasInit
  });
  if (auth.source === 'botapi') {
    const now = Math.floor(Date.now()/1000);
    const token = signSession({ user: auth.user, iat: now, exp: now + SESSION_TTL_SEC }, SESSION_SECRET);
    setSessionCookie(res, token);
  }
  return sendJSON(res, 200, { ok:true, user: auth.user, source: auth.source });
};
