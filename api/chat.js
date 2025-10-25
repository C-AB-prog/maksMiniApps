const { getOrCreateUser, readJSON, sendJSON } = require('./_utils');
const { ensureSchema, upsertUser } = require('./_db');

module.exports = async (req,res)=>{
  try{
    if(req.method!=='POST'){ res.setHeader('Allow','POST'); return sendJSON(res,405,{error:'Method Not Allowed'}); }
    const qs = (()=>{ try{ return new URL(req.url,'http://x').searchParams }catch{ return new URLSearchParams() } })();
    const tz = qs.get('tz') || null;

    const { user } = getOrCreateUser(req,res);
    await ensureSchema(); await upsertUser(user, tz);

    const body = await readJSON(req);
    const q = String(body.q||'').trim();

    // мини-подсказки до подключения LLM
    let a = 'Я могу: сформировать фокус, разбить задачу на подзадачи, расставить приоритеты, составить план, поставить напоминания.';
    if (/фокус/i.test(q)) a = 'Ок, давай сформируем фокус. Напиши главную цель на сегодня/неделю — предложу формулировку и чек-лист.';
    if (/подзадач/i.test(q)) a = 'Скинь задачу — разложу на подзадачи и приоритеты.';
    if (/план/i.test(q)) a = 'Сделаю план на неделю: цели → задачи → дедлайны. Напиши, что важно достигнуть.';
    if (/напомин/i.test(q)) a = 'Готов поставить напоминание: укажи задачу и время (напр. «напомни завтра в 10:00»).';

    return sendJSON(res,200,{ a });
  }catch(e){ return sendJSON(res,500,{error:e.message}); }
};
