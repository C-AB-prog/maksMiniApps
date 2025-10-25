// api/focus.js
import { getUserFromRequest } from "./_utils/auth.js";
import { q, ensureTables, ensureUser } from "./_utils/db.js";

export default async function handler(req, res){
  try{
    await ensureTables();
    const { user_id } = getUserFromRequest(req);
    await ensureUser(user_id);

    if(req.method === "GET"){
      const r = await q(`select text, updated_at from focus where user_id=$1`, [user_id]);
      return res.status(200).json(r.rows[0] || {});
    }

    if(req.method === "PUT"){
      const { text } = JSON.parse(req.body||"{}");
      await q(`
        insert into focus(user_id, text, updated_at)
        values ($1,$2,now())
        on conflict (user_id) do update set text=excluded.text, updated_at=now()
      `,[user_id, text||null]);
      return res.status(200).json({ok:true});
    }

    res.status(405).json({error:"METHOD_NOT_ALLOWED"});
  }catch(e){
    res.status(e.status||500).json({error:e.message||"SERVER_ERROR"});
  }
}
