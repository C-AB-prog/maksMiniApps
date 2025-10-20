// Cloudflare Pages Function: GET /api/ping
export async function onRequest() {
  return new Response(JSON.stringify({ ok:true, platform:'cloudflare-pages', time:new Date().toISOString() }), {
    headers: { 'content-type':'application/json', 'access-control-allow-origin':'*' }
  });
}
