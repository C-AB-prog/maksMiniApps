// api/tasks/index.js
import { getUserFromRequest } from "../_utils/auth.js";
import { q, ensureTables, ensureUser } from "../_utils/db.js";

export default async function handler(req,res){
  try{
    await ensureTables();
    const { user_id } = getUserFromRequest(req);
    await ensureUser(user_id);

    if(req.method === "GET"){
      const r = await q(
        `select id,title,scope,due_at,done,created_at,updated_at
         from tasks
         where user_id=$1
         order by done asc, coalesce(due_at, now()+interval '100 years') asc, id desc`,
        [user_id]
      );
      return res.status(200).json({tasks:r.rows});
    }

    if(req.method === "POST"){
      const { title, due_at, scope } = JSON.parse(req.body||"{}");
      if(!title) return res.status(400).json({error:"TITLE_REQUIRED"});
      const r = await q(
        `insert into tasks(user_id,title,scope,due_at)
         values($1,$2,$3,$4) returning id`,
        [user_id, title, scope||'today', due_at||null]
      );
      return res.status(200).json({id:r.rows[0].id});
    }

    res.status(405).json({error:"METHOD_NOT_ALLOWED"});
  }catch(e){
    res.status(e.status||500).json({error:e.message||"SERVER_ERROR"});
  }
}
