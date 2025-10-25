// /api/whoami.js
const { getUserFromReq, sendJSON } = require('./_utils');
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

module.exports = async (req,res)=>{
  const auth = getUserFromReq(req, BOT_TOKEN);
  if (!auth.ok) return sendJSON(res, auth.status, {
    error: auth.error, reason: auth.reason, hasInit: auth.hasInit, initLen: auth.initLen
  });
  return sendJSON(res, 200, { ok:true, user: auth.user });
};
