// /api/_utils.js
const crypto = require('crypto');

const SESSION_COOKIE = 'sid';
const SESSION_TTL_SEC = 60*60*24*30;
const BOTAPI_TIMEOUT_MS = Number(process.env.BOTAPI_TIMEOUT_MS || 1500);
const TELEGRAM_FALLBACK_BOTAPI = process.env.TELEGRAM_FALLBACK_BOTAPI !== '0';
const STRICT_WEBAPP = process.env.STRICT_WEBAPP === '1';

function parseCookies(req){ const hdr=req.headers['cookie']||''; const out={}; hdr.split(';').forEach(p=>{const[k,v]=p.split('='); if(!k)return; out[k.trim()]=decodeURIComponent((v||'').trim())}); return out; }
function signSession(payload, secret){ const data=Buffer.from(JSON.stringify(payload)).toString('base64url'); const sig=crypto.createHmac('sha256', secret).update(data).digest('base64url'); return `${data}.${sig}`; }
function verifySession(token, secret){ if(!token) return null; const[data,sig]=token.split('.'); if(!data||!sig) return null; const exp=crypto.createHmac('sha256',secret).update(data).digest('base64url'); if(sig!==exp) return null; try{const o=JSON.parse(Buffer.from(data,'base64url').toString('utf8')); if(!o?.user?.id) return null; if(o.exp && Date.now()/1000 > o.exp) return null; return o;}catch{return null;} }
function setSessionCookie(res, token, maxAgeSec=SESSION_TTL_SEC){ const parts=[`${SESSION_COOKIE}=${token}`,'Path=/','HttpOnly','Secure','SameSite=None',`Max-Age=${maxAgeSec}`]; res.setHeader('Set-Cookie', parts.join('; ')); }

function getQS(req){ try{ return new URL(req.url,'http://localhost').searchParams }catch{ return new URLSearchParams() } }
function getInitDataFromReq(req){ let s=req.headers['x-telegram-init-data']||''; if(!s){ const qs=getQS(req); const q=qs.get('init_data'); if(q) s=q; } return s||''; }
function parsedInitData(str=''){ const o={}; for(const part of str.split('&')){ if(!part) continue; const i=part.indexOf('='); const k=i>=0?part.slice(0,i):part; const v=i>=0?part.slice(i+1):''; o[decodeURIComponent(k)] = decodeURIComponent(v||''); } if(typeof o.user==='string'){ try{o.user=JSON.parse(o.user)}catch{} } return o; }
function buildDCS(str=''){ const pairs=[]; for(const part of (str||'').split('&')){ if(!part) continue; const i=part.indexOf('='); const k=i>=0?part.slice(0,i):part; if(k==='hash') continue; const v=i>=0?part.slice(i+1):''; pairs.push([k,v]); } pairs.sort((a,b)=>a[0].localeCompare(b[0])); return pairs.map(([k,v])=>`${k}=${v}`).join('\n'); }
function verifyWebAppBoth(str, botToken, maxAge=86400){
  if(!str) return {ok:false,reason:'NO_INITDATA'};
  const p=parsedInitData(str); if(!p.hash) return {ok:false,reason:'NO_HASH'}; if(!p.auth_date) return {ok:false,reason:'NO_AUTH_DATE'};
  const now=Math.floor(Date.now()/1000), ad=Number(p.auth_date); if(Number.isFinite(ad)&&(now-ad)>maxAge) return {ok:false,reason:'EXPIRED'};
  const dcs=buildDCS(str);
  const secA=crypto.createHmac('sha256','WebAppData').update(botToken).digest(); const calcA=crypto.createHmac('sha256',secA).update(dcs).digest('hex');
  const secB=crypto.createHmac('sha256',botToken).update('WebAppData').digest(); const calcB=crypto.createHmac('sha256',secB).update(dcs).digest('hex');
  if(calcA===p.hash) return {ok:true,method:'A',data:p}; if(calcB===p.hash) return {ok:true,method:'B',data:p}; return {ok:false,reason:'BAD_HASH'};
}
async function verifyViaBotAPI(userId, botToken){
  if(!botToken||!userId) return false;
  const ctrl=new AbortController(); const t=setTimeout(()=>ctrl.abort(), BOTAPI_TIMEOUT_MS);
  try{ const url=`https://api.telegram.org/bot${botToken}/getChat?chat_id=${encodeURIComponent(String(userId))}`;
    const r=await fetch(url,{signal:ctrl.signal}); clearTimeout(t); if(!r.ok) return false; const j=await r.json();
    return !!(j&&j.ok&&j.result&&String(j.result.id)===String(userId));
  }catch{ clearTimeout(t); return false; }
}
function looksLikeTelegram(req){ const ua=String(req.headers['user-agent']||'').toLowerCase(); const ref=String(req.headers['referer']||'').toLowerCase(); return ua.includes('telegram')||ref.includes('t.me')||ref.includes('telegram'); }

async function getUserFromReq(req, botToken){
  const sessionSecret = process.env.SESSION_SECRET || (botToken || 'dev_secret');

  // 0) cookie
  const ses = verifySession(parseCookies(req)[SESSION_COOKIE], sessionSecret);
  if(ses?.user?.id) return { ok:true, user: ses.user, source:'cookie' };

  // 1) валидная подпись
  const initStr = getInitDataFromReq(req);
  if(initStr){
    const v = verifyWebAppBoth(initStr, botToken);
    if(v.ok && v.data?.user?.id) return { ok:true, user:v.data.user, initData:v.data, source:`webapp_${v.method}` };

    // 1b) Bot API фолбэк
    const p = parsedInitData(initStr); const uid = p?.user?.id;
    if(TELEGRAM_FALLBACK_BOTAPI && uid){ const ok = await verifyViaBotAPI(uid, botToken); if(ok) return { ok:true, user:p.user, initData:p, source:'botapi' }; }
  }

  // 2) жёсткий uid-фолбэк из query (из initDataUnsafe.user)
  if(!STRICT_WEBAPP && looksLikeTelegram(req)){
    const qs = getQS(req); const uid = qs.get('uid');
    if(uid && /^\d+$/.test(uid)){
      const user = { id:Number(uid), username:qs.get('un')||null, first_name:qs.get('ufn')||null, last_name:qs.get('uln')||null };
      return { ok:true, user, source:'uid_fallback' };
    }
  }

  // 3) нет авторизации
  if(initStr) return { ok:false, status:401, error:'Unauthorized', reason:'BAD_INITDATA', hasInit:true };
  return { ok:false, status:401, error:'Unauthorized', reason:'NO_INITDATA', hasInit:false };
}

function sendJSON(res, status, obj){ res.setHeader('Content-Type','application/json; charset=utf-8'); res.status(status).end(JSON.stringify(obj)); }

module.exports = { signSession, verifySession, setSessionCookie, getInitDataFromReq, parsedInitData, verifyWebAppBoth, getUserFromReq, sendJSON, SESSION_TTL_SEC };
