// api/_utils/tg_node.js — проверка подписи Telegram (Node)
import crypto from 'crypto';

export async function verifyTelegramInitNode(initData, botToken){
  if (!initData || !botToken) return false;

  const params = new URLSearchParams(initData);
  const hash = params.get('hash') || '';
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort((a,b)=>a[0].localeCompare(b[0]))
    .map(([k,v]) => `${k}=${v}`)
    .join('\n');

  const secret = crypto.createHmac('sha256','WebAppData').update(botToken).digest();
  const calc   = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  return calc === hash;
}

export function parseTelegramUser(initData){
  try {
    const p = new URLSearchParams(initData || '');
    const raw = p.get('user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
