const { getOrCreateUser, sendJSON, tgSendMessage } = require('../_utils');
const { pool, ensureSchema } = require('../_db');

module.exports = async (req,res)=>{
  try{
    await ensureSchema();

    // Выбираем все задачи, где напоминание наступило, и нет отправленного уведомления в notifications
    const { rows: dueRows } = await pool.query(`
      SELECT t.id, t.user_id, t.title, t.remind_at, u.id as chat_id
      FROM tasks t
      JOIN users u ON u.id = t.user_id
      WHERE t.remind_at IS NOT NULL
        AND t.done = FALSE
        AND t.remind_at <= now()
        AND NOT EXISTS (
          SELECT 1 FROM notifications n
          WHERE n.user_id = t.user_id AND n.task_id = t.id
            AND n.type = 'reminder' AND n.sent_at IS NOT NULL
        )
      ORDER BY t.remind_at ASC
      LIMIT 100
    `);

    for(const r of dueRows){
      const text = `🔔 Напоминание:\n<b>${r.title}</b>`;
      const sent = await tgSendMessage(r.chat_id, text);
      await pool.query(
        `INSERT INTO notifications (user_id, task_id, type, run_at, payload, sent_at, error)
         VALUES ($1,$2,'reminder', now(), $3, $4, $5)`,
        [r.user_id, r.id, JSON.stringify({ title: r.title }), sent.ok ? 'now()' : null, sent.ok ? null : (sent.description || 'send fail')]
      );
    }

    return sendJSON(res,200,{ ok:true, processed: dueRows.length });
  }catch(e){ return sendJSON(res,500,{error:e.message}); }
};
