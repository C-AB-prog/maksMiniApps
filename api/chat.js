// api/chat.js
import { getUserFromRequest } from "./_utils/auth.js";
import { ensureTables, ensureUser } from "./_utils/db.js";

export default async function handler(req,res){
  try{
    await ensureTables();
    const { user_id } = getUserFromRequest(req);
    await ensureUser(user_id);

    if(req.method!=="POST") return res.status(405).json({error:"METHOD_NOT_ALLOWED"});
    const { q } = JSON.parse(req.body||"{}");
    if(!q) return res.status(400).json({error:"EMPTY"});

    const key = process.env.OPENAI_API_KEY;
    if(!key) return res.status(500).json({error:"OPENAI_API_KEY_MISSING"});

    // Простой ответ без сохранения истории
    const r = await fetch("https://api.openai.com/v1/chat/completions",{
      method:"POST",
      headers:{ "Content-Type":"application/json", "Authorization":`Bearer ${key}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {role:"system",content:"Ты краткий и дружелюбный помощник по задачам, фокусу дня и плану."},
          {role:"user",content:q}
        ],
        temperature:0.6,
      })
    });
    if(!r.ok){
      const t = await r.text().catch(()=> "");
      const code = r.status;
      return res.status(code===401?401:500).json({error: t || "OPENAI_ERROR"});
    }
    const j = await r.json();
    const a = j.choices?.[0]?.message?.content?.trim() || "…";
    return res.status(200).json({a});
  }catch(e){
    res.status(e.status||500).json({error:e.message||"SERVER_ERROR"});
  }
}
