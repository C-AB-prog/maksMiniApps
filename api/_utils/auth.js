// api/_utils/auth.js
import crypto from "crypto";

/**
 * Универсальная выборка initData из заголовка/URL.
 */
export function extractInitData(req) {
  const fromHeader = req.headers["x-telegram-init-data"] || req.headers["x-telegram-web-app-data"];
  if (fromHeader) return String(fromHeader);
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const q = url.searchParams.get("tgWebAppData");
    if (q) return q;
  } catch (_) {}
  const raw = req.body?.__initData || ""; // на случай, если фронт прислал вручную
  return String(raw || "");
}

/**
 * Проверка подписи Telegram WebApp.
 * Возвращает { ok, userId, reason }
 */
export function verifyTelegramInitData(rawInitData, botToken) {
  try {
    if (!rawInitData) return { ok: false, reason: "NO_INIT_DATA" };
    const params = new URLSearchParams(rawInitData);
    const hash = params.get("hash");
    if (!hash) return { ok: false, reason: "NO_HASH" };

    // data_check_string — отсортированные пары key=value (кроме hash)
    const pairs = [];
    for (const [k, v] of params.entries()) {
      if (k === "hash") continue;
      pairs.push(`${k}=${v}`);
    }
    pairs.sort();
    const data_check_string = pairs.join("\n");

    // secret_key = HMAC-SHA256 от "WebAppData" по SHA256(botToken)
    if (!botToken) return { ok: false, reason: "NO_BOT_TOKEN" };
    const secret = crypto.createHmac("sha256", crypto.createHash("sha256").update(botToken).digest())
      .update("WebAppData")
      .digest();

    const signature = crypto.createHmac("sha256", secret).update(data_check_string).digest("hex");
    if (signature !== hash) return { ok: false, reason: "BAD_SIGNATURE" };

    // достаём user.id
    const userStr = params.get("user");
    const user = userStr ? JSON.parse(userStr) : null;
    const userId = user?.id ? Number(user.id) : null;
    if (!userId) return { ok: false, reason: "NO_USER_ID" };
    return { ok: true, userId };
  } catch (e) {
    return { ok: false, reason: "VERIFY_ERR" };
  }
}

/**
 * Мягкая авторизация.
 * По порядку:
 *  1) если подпись валидна — берём userId из Telegram
 *  2) если нет — dev-фолбэк (вшитый), по секрету в query (?dev=dev-allow) либо по tg_id
 *  3) иначе 401
 */
export function softAuth(req) {
  const raw = extractInitData(req);
  const botToken = process.env.BOT_TOKEN || ""; // может быть пустым — тогда сразу уйдем в dev-ветку
  const ver = verifyTelegramInitData(raw, botToken);
  if (ver.ok) return { ok: true, userId: ver.userId, mode: "telegram" };

  // --- dev-фолбэк (код-только, без переменных окружения) ---
  const DEV = { enabled: true, secret: "dev-allow", defaultUserId: 999000111 }; // можно поменять
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const dev = url.searchParams.get("dev");
    const tgIdParam = url.searchParams.get("tg_id");
    if (DEV.enabled && dev === DEV.secret) {
      const tgId = tgIdParam ? Number(tgIdParam) : DEV.defaultUserId;
      if (Number.isFinite(tgId)) return { ok: true, userId: tgId, mode: "dev" };
    }
  } catch (_) {}

  // как самый последний шанс — если в initData есть user без подписи, доверимся ему
  if (raw) {
    try {
      const u = new URLSearchParams(raw).get("user");
      const parsed = u ? JSON.parse(u) : null;
      const uid = parsed?.id ? Number(parsed.id) : null;
      if (uid) return { ok: true, userId: uid, mode: "unsafe" };
    } catch (_) {}
  }

  return { ok: false, reason: ver.reason || "UNAUTHORIZED" };
}
