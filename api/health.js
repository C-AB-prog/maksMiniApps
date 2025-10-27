// /api/health.js

const payload = () => ({
  ok: true,
  env: process.env.VERCEL_ENV || 'unknown',
  region: process.env.VERCEL_REGION || 'unknown',
  time: new Date().toISOString()
});

// Вариант для Vercel Functions (Node)
export default async function handler(req, res) {
  if (res) {
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.status(200).end(JSON.stringify(payload()));
    return;
  }
  // Фолбэк для сред с Fetch API
  return new Response(JSON.stringify(payload()), {
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

// Вариант для роутинга через метод GET (если у тебя так настроены остальные файлы)
export async function GET() {
  return new Response(JSON.stringify(payload()), {
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}
