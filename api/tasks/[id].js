// api/tasks/[id].js
import { getUserFromRequest } from "../_utils/auth.js";
import { q, ensureTables, ensureUser } from "../_utils/db.js";

export default async function handler(req,res){
  try{
    await ensureTables();
    const { user_id } = getUserFromRequest(req);
    await ensureUser(user_id);

    const id = Number(req.query.id);
    if(!id) return res.status(400).json({error:"BAD_ID"});

    if(req.method === "PUT"){
      const { done } = JSON.parse(req.body||"{}");
      const r = await q(`update tasks set done=$1, updated_at=now() where id=$2 and user_id=$3`,
        [!!done, id, user_id]);
      if(r.rowCount===0) return res.status(404).json({error:"TASK_NOT_FOUND"});
      return res.status(200).json({ok:true});
    }

    if(req.method === "DELETE"){
      await q(`delete from tasks where id=$1 and user_id=$2`,[id,user_id]);
      return res.status(200).json({ok:true});
    }

    res.status(405).json({error:"METHOD_NOT_ALLOWED"});
  }catch(e){
    res.status(e.status||500).json({error:e.message||"SERVER_ERROR"});
  }
}
