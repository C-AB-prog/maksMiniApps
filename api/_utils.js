const crypto = require('crypto');

const SESSION_COOKIE = 'sid';
const SESSION_TTL_SEC = 60 * 60 * 24 * 30;
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev_secret';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

function parseCookies(req){ const hdr=req.headers['cookie']||''; const out={}; hdr.split(';').forEach(p=>{ const[k,v]=p.split('='); if(!k)return; out[k.trim()]=decodeURIComponent((v||'').trim()); }); return out; }
function signSession(payload){ const data=Buffer.from(JSON.stringify(payload)).toString('base64url'); const sig=crypto.createHmac('sha256',SESSION_SECRET).update(data).digest('base64url'); return `${data}.${sig}`; }
function verifySession(token){ if(!token) return null; const [data,sig]=token.split('.'); if(!data||!sig) return null; const exp=crypto.createHmac('sha256',SESSION_SECRET).update(data).digest('base64url'); if(sig!==exp) return null; try{ const o=JSON.parse(Buffer.from(data,'base64url').toString('utf8')); if(!o?.user?.id) return null; if(o.exp && Date.now()/1000 > o.exp) return null; return o; }catch{ return null; } }
function setSessionCookie(res, token, maxAge=SESSION_TTL_SEC){ const parts=[`${SESSION_COOKIE}=${token}`,'Path=/','HttpOnly','Secure','SameSite=None',`Max-Age=${maxAge}`]; res.setHeader('Set-Cookie', parts.join('; ')); }

function getQS(req){ try{ return new URL(req.url,'http://localhost').searchParams }catch{ return new URLSearchParams() } }
function getInitDataFromReq(req){ let s=req.headers['x-telegram-init-data']||''; if(!s){ const qs=getQS(req); const q=qs.get('init_data'); if(q) s=q; } return s||''; }
function parsedInitData(str=''){ const o={}; for(const part of (str||'').split('&')){ if(!part) continue; const i=part.indexOf('='); const k=i>=0?part.slice(0,i):part; const v=i>=0?part.slice(i+1):''; o[decodeURIComponent(k)] = decodeURIComponent(v||''); } if(typeof o.user==='string'){ try{o.user=JSON.parse(o.user)}catch{} } return o; }

function genSafeUserId(){ const max=9007199254740991n, min=1000000000000n; const buf=crypto.randomBytes(8); let x = BigInt('0x'+buf.toString('hex')) & ((1n<<53n)-1n); if(x<min) x+=min; if(x>max) x=(x%(max-min+1n))+min; return Number(x); }

function getOrCreateUser(req, res){
  // 1) cookie?
  const ses = verifySession(parseCookies(req)[SESSION_COOKIE]);
  if(ses?.user?.id) return { user: ses.user, source: 'cookie' };

  // 2) telegram user
  const init = getInitDataFromReq(req);
  const p = parsedInitData(init);
  if (p?.user?.id) {
    const u = { id:Number(p.user.id), username:p.user.username||null, first_name:p.user.first_name||null, last_name:p.user.last_name||null };
    const now=Math.floor(Date.now()/1000); setSessionCookie(res, signSession({user:u,iat:now,exp:now+SESSION_TTL_SEC}));
    return { user:u, source:'telegram' };
  }

  // 3) uid из query
  const qs = getQS(req); const uid = qs.get('uid');
  if(uid && /^\d+$/.test(uid)){ const u={ id:Number(uid), username:qs.get('un')||null, first_name:qs.get('ufn')||null, last_name:qs.get('uln')||null };
    const now=Math.floor(Date.now()/1000); setSessionCookie(res, signSession({user:u,iat:now,exp:now+SESSION_TTL_SEC}));
    return { user:u, source:'uid' };
  }

  // 4) аноним
  const u={ id: genSafeUserId(), username:null, first_name:null, last_name:null };
  const now=Math.floor(Date.now()/1000); setSessionCookie(res, signSession({user:u,iat:now,exp:now+SESSION_TTL_SEC}));
  return { user:u, source:'anon' };
}

async function readJSON(req){
  const chunks=[]; for await (const ch of req) chunks.push(ch);
  try{ return JSON.parse(Buffer.concat(chunks).toString()||'{}'); }catch{ return {}; }
}

function sendJSON(res, status, obj){ res.setHeader('Content-Type','application/json; charset=utf-8'); res.status(status).end(JSON.stringify(obj)); }

async function tgSendMessage(chatId, text, extra={}){
  if(!BOT_TOKEN) return { ok:false, error:'NO_BOT_TOKEN' };
  const ctrl = new AbortController(); const timeout = setTimeout(()=>ctrl.abort(), 5000);
  try{
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ chat_id: chatId, text, parse_mode:'HTML', disable_web_page_preview:true, ...extra }),
      signal: ctrl.signal
    });
    clearTimeout(timeout);
    const j = await r.json().catch(()=> ({}));
    return j;
  }catch(e){ clearTimeout(timeout); return { ok:false, error:String(e) }; }
}

module.exports = { getOrCreateUser, readJSON, sendJSON, tgSendMessage };
