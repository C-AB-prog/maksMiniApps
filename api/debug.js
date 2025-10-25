const { getInitDataFromReq, parsedInitData, verifyWebAppBoth, sendJSON } = require('./_utils');
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

module.exports = async (req,res)=>{
  const initStr = getInitDataFromReq(req);
  const parsed = initStr ? parsedInitData(initStr) : null;
  const v = initStr ? verifyWebAppBoth(initStr, BOT_TOKEN) : { ok:false, reason:'NO_INITDATA' };
  const qs = (()=>{ try{ return new URL(req.url,'http://x').searchParams }catch{ return new URLSearchParams() } })();
  return sendJSON(res,200,{
    ua: req.headers['user-agent']||'',
    ref: req.headers['referer']||'',
    initLen: (initStr||'').length,
    verify: { ok:v.ok, reason:v.reason||null, method:v.method||null },
    parsedKeys: parsed ? Object.keys(parsed) : [],
    uid: qs.get('uid') || null
  });
};
