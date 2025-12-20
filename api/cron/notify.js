// api/cron/notify.js
import { q, ensureSchema } from '../_db.js';
import { getTgIdsForTask } from '../_utils.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || '';

export default async function handler(req, res) {
  await ensureSchema();
  if (!BOT_TOKEN) return res.status(200).json({ ok:false, error:'TELEGRAM_BOT_TOKEN missing' });

  const now = Date.now();
  const soon = now + 15 * 60 * 1000; // 15 минут

  // 1) Предупреждения "скоро дедлайн"
  const dueSoon = await q(`
    SELECT t.id, t.title, t.due_ts
    FROM tasks t
    LEFT JOIN task_notifications n ON n.task_id = t.id
    WHERE t.is_done = false
      AND t.due_ts IS NOT NULL
      AND t.due_ts BETWEEN $1 AND $2
      AND (n.sent_due_warning = false OR n.sent_due_warning IS NULL)
    LIMIT 200
  `, [now, soon]);

  for (const row of dueSoon.rows) {
    const text = `⏰ Скоро дедлайн: <b>${escapeHtml(row.title)}</b>\nдо ${fmt(row.due_ts)}`;
    const recipients = await getTgIdsForTask(row.id);
    await sendToMany(recipients, text);
    await q(`
      INSERT INTO task_notifications(task_id, sent_due_warning, updated_at)
      VALUES ($1, true, now())
      ON CONFLICT (task_id) DO UPDATE SET sent_due_warning = true, updated_at = now()
    `, [row.id]);
  }

  // 2) Просроченные
  const overdue = await q(`
    SELECT t.id, t.title, t.due_ts
    FROM tasks t
    LEFT JOIN task_notifications n ON n.task_id = t.id
    WHERE t.is_done = false
      AND t.due_ts IS NOT NULL
      AND t.due_ts < $1
      AND (n.sent_overdue = false OR n.sent_overdue IS NULL)
    LIMIT 200
  `, [now]);

  for (const row of overdue.rows) {
    const text = `❗️ Просрочено: <b>${escapeHtml(row.title)}</b>\nсрок был ${fmt(row.due_ts)}`;
    const recipients = await getTgIdsForTask(row.id);
    await sendToMany(recipients, text);
    await q(`
      INSERT INTO task_notifications(task_id, sent_overdue, updated_at)
      VALUES ($1, true, now())
      ON CONFLICT (task_id) DO UPDATE SET sent_overdue = true, updated_at = now()
    `, [row.id]);
  }

  res.json({ ok:true, dueSoon: dueSoon.rows.length, overdue: overdue.rows.length });
}

async function sendToMany(ids, text) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  await Promise.all(ids.map(tg =>
    fetch(url, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ chat_id: tg, text, parse_mode: 'HTML', disable_web_page_preview: true })
    }).catch(()=>null)
  ));
}

function fmt(ms){
  try{ return new Date(Number(ms)).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}); }
  catch{ return ''; }
}
function escapeHtml(s){ return String(s).replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m])); }
