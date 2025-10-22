// api/health.js
export const config = { runtime: 'nodejs' };

import { sql } from '@vercel/postgres';
import { ensureTables, verifyTelegramInit, upsertUserFromInit } from './_utils/db.js';

export default async function handler(req) {
  try {
    const init = req.headers.get('x-telegram-init') || '';
    const botToken = process.env.BOT_TOKEN || '';

    const tgOk = !!botToken && verifyTelegramInit(init, botToken);
    let user = null, dbOk = false, hasPg = !!process.env.POSTGRES_URL;

    if (tgOk) {
      try { await ensureTables(); await sql`select 1`; dbOk = true; } catch { dbOk = false; }
      user = await upsertUserFromInit(init);
    }

    return new Response(JSON.stringify({
      ok: tgOk && dbOk,
      telegram_signature_ok: tgOk,
      user_id: user?.id || null,
      env: { has_POSTGRES_URL: hasPg, has_BOT_TOKEN: !!botToken },
      db_ok: dbOk
    }), { status: 200, headers: { 'content-type': 'application/json' } });

  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || 'INTERNAL_ERROR' }), {
      status: 500, headers: { 'content-type': 'application/json' }
    });
  }
}
