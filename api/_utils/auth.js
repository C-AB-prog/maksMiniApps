// api/_utils/auth.js
import crypto from "crypto";

const REQUIRED_ENV = ["BOT_TOKEN"];
export function ensureEnv() {
  REQUIRED_ENV.forEach(k=>{
    if(!process.env[k]) throw new Error(`Missing env ${k}`);
  });
}

/** Возвращает { user_id } или бросает 401 */
export function getUserFromRequest(req) {
  const raw = req.headers["x-telegram-init-data"] || "";
  const allowUnsigned = process.env.ALLOW_UNSIGNED === "1";
  const devId = process.env.DEV_USER_ID;

  if (!raw) {
    if (allowUnsigned && devId) return { user_id: String(devId) };
    const e = new Error("UNAUTHORIZED"); e.status = 401; throw e;
  }

  // Проверка подписи initData (официальная схема)
  ensureEnv();
  const url = new URLSearchParams(String(raw));
  const hash = url.get("hash");
  url.delete("hash");
  const data = [];
  Array.from(url.keys()).sort().forEach(k=> data.push(`${k}=${url.get(k)}`));
  const checkString = data.join("\n");

  const secret = crypto
    .createHmac("sha256", "WebAppData")
    .update(process.env.BOT_TOKEN)
    .digest();

  const computed = crypto
    .createHmac("sha256", secret)
    .update(checkString)
    .digest("hex");

  if (computed !== hash) {
    if (allowUnsigned && devId) return { user_id: String(devId) };
    const e = new Error("UNAUTHORIZED"); e.status = 401; throw e;
  }

  const initDataUser = url.get("user"); // JSON
  try {
    const user = JSON.parse(initDataUser || "{}");
    if (!user?.id) throw 0;
    return { user_id: String(user.id) };
  } catch {
    if (allowUnsigned && devId) return { user_id: String(devId) };
    const e = new Error("UNAUTHORIZED"); e.status = 401; throw e;
  }
}
