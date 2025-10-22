// api/_utils/tg.js
const enc = new TextEncoder();

function toHex(buffer){
  const b = new Uint8Array(buffer);
  let s = '';
  for (let i=0; i<b.length; i++) s += b[i].toString(16).padStart(2,'0');
  return s;
}

async function hmac(signKeyRaw, dataRaw){
  const key = await crypto.subtle.importKey(
    'raw',
    typeof signKeyRaw === 'string' ? enc.encode(signKeyRaw) : signKeyRaw,
    { name:'HMAC', hash:'SHA-256' },
    false,
    ['sign']
  );
  return crypto.subtle.sign('HMAC', key, typeof dataRaw === 'string' ? enc.encode(dataRaw) : dataRaw);
}

/** Проверка подписи Telegram WebApp initData */
export async function verifyTelegramInit(initData, botToken){
  if (!initData || !botToken) return false;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash') || '';
  params.delete('hash');

  const pairs = [];
  for (const [k,v] of params.entries()) pairs.push([k,v]);
  pairs.sort((a,b) => a[0].localeCompare(b[0]));
  const dataCheckString = pairs.map(([k,v]) => `${k}=${v}`).join('\n');

  const secret = await hmac('WebAppData', botToken); // HMAC(WebAppData, BOT_TOKEN)
  const sign = await hmac(secret, dataCheckString);
  const myHash = toHex(sign);

  return myHash === hash;
}

export function parseTelegramUser(initData){
  try{
    const params = new URLSearchParams(initData || '');
    const raw = params.get('user');
    return raw ? JSON.parse(raw) : null;
  }catch(e){ return null }
}
