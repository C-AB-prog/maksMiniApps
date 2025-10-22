// api/_utils/tg_node.js
import crypto from "crypto";

/** Проверка подписи Telegram WebApp initData (Node: crypto.createHmac) */
export function verifyTelegramInitNode(initData, botToken) {
  if (!initData || !botToken) return false;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash") || "";
  params.delete("hash");

  const pairs = [];
  for (const [k, v] of params.entries()) pairs.push([k, v]);
  pairs.sort((a, b) => a[0].localeCompare(b[0]));
  const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join("\n");

  const secret = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();

  const myHash = crypto
    .createHmac("sha256", secret)
    .update(dataCheckString)
    .digest("hex");

  return myHash === hash;
}

export function parseTelegramUser(initData) {
  try {
    const params = new URLSearchParams(initData || "");
    const raw = params.get("user");
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}
