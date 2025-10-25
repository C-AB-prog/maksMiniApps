const { sendJSON, tgSendMessage } = require('../_utils');
const { pool, ensureSchema } = require('../_db');

module.exports = async (req,res)=>{
  try{
    await ensureSchema();

    // берём пользователей с TZ
    const { rows: users } = await pool.query(`SELECT id, COALESCE(tz,'UTC') as tz FROM users LIMIT 1000`);
    let count = 0;

    for(const u of users){
      // Дайджест раз в день: проверим, не отправляли ли уже сегодня
      const { rows: sent } = await pool.query(
        `SELECT 1 FROM notifications
          WHERE user_id=$1 AND type='digest' AND sent_at::date = (now() at time zone $2)::date
          LIMIT 1`, [u.id, u.tz]
      );
      if (sent[0]) continue;

      // формируем выборки (сегодня + просроченные)
      const { rows: focus } = await pool.query(`SELECT text FROM focus WHERE user_id=$1`, [u.id]);
      const { rows: today } = await pool.query(`
        SELECT title FROM tasks
        WHERE user_id=$1 AND done=FALSE
          AND (due_at AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date
        ORDER BY priority DESC, created_at ASC
        LIMIT 20`, [u.id, u.tz]);
      const { rows: overdue } = await pool.query(`
        SELECT title FROM tasks
        WHERE user_id=$1 AND done=FALSE
          AND due_at IS NOT NULL
          AND (due_at AT TIME ZONE $2) < (now() AT TIME ZONE $2)
          AND (due_at AT TIME ZONE $2)::date < (now() AT TIME ZONE $2)::date
        ORDER BY due_at ASC
        LIMIT 20`, [u.id, u.tz]);

      const parts = [];
      if (focus[0]?.text) parts.push(`🎯 <b>Фокус:</b> ${focus[0].text}`);
      if (today.length){
        parts.push('📌 <b>Сегодня:</b>');
        today.forEach((t,i)=> parts.push(`  • ${t.title}`));
      }
      if (overdue.length){
        parts.push('⏰ <b>Просрочено:</b>');
        overdue.forEach((t,i)=> parts.push(`  • ${t.title}`));
      }
      if (!parts.length) continue;

      const text = parts.join('\n');
      const sentMsg = await tgSendMessage(u.id, text);
      await pool.query(
        `INSERT INTO notifications (user_id, type, run_at, payload, sent_at, error)
         VALUES ($1,'digest', now(), $2, $3, $4)`,
        [u.id, JSON.stringify({ lines: parts.length }), sentMsg.ok ? 'now()' : null, sentMsg.ok ? null : (sentMsg.description || 'send fail')]
      );
      if (sentMsg.ok) count++;
    }

    return sendJSON(res,200,{ ok:true, sent: count });
  }catch(e){ return sendJSON(res,500,{error:e.message}); }
};
