// api/ping.js
export const config = { runtime: 'edge' };
export default async function handler() {
  return new Response(JSON.stringify({ ok:true, edge:true, time:new Date().toISOString() }), {
    headers:{ 'content-type':'application/json', 'access-control-allow-origin':'*' }
  });
}
