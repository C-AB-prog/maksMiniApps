const { getOrCreateUser, sendJSON } = require('../_utils');
const { ensureSchema, upsertUser } = require('../_db');

module.exports = async (req,res)=>{
  try{
    if(req.method!=='PUT'){ res.setHeader('Allow','PUT'); return sendJSON(res,405,{error:'Method Not Allowed'}); }
    const qs = (()=>{ try{ return new URL(req.url,'http://x').searchParams }catch{ return new URLSearchParams() } })();
    const tz = qs.get('tz') || null;

    const { user } = getOrCreateUser(req,res);
    await ensureSchema(); await upsertUser(user, tz);
    return sendJSON(res,200,{ ok:true, tz });
  }catch(e){ return sendJSON(res,500,{error:e.message}); }
};
