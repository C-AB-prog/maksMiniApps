const { getOrCreateUser } = require('../_utils');
const { pool, ensureSchema, upsertUser } = require('../_db');

function icsEscape(s){ return String(s||'').replace(/\\|;|,|\n/g, m=> ({'\\':'\\\\',';':'\\;','\,':'\\,','\n':'\\n'}[m])); }

module.exports = async (req,res)=>{
  try{
    const qs = (()=>{ try{ return new URL(req.url,'http://x').searchParams }catch{ return new URLSearchParams() } })();
    const tz = qs.get('tz') || null;

    const { user } = getOrCreateUser(req,res);
    await ensureSchema(); await upsertUser(user, tz);

    const { rows } = await pool.query(
      `SELECT id,title,due_at FROM tasks WHERE user_id=$1 AND due_at IS NOT NULL ORDER BY due_at ASC`, [user.id]
    );

    const dtstamp = new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Growth Assistant//EN'
    ];
    for(const t of rows){
      const due = new Date(t.due_at);
      const dt = due.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
      lines.push(
        'BEGIN:VEVENT',
        `UID:task-${t.id}@growth-assistant`,
        `DTSTAMP:${dtstamp}`,
        `DTSTART:${dt}`,
        `SUMMARY:${icsEscape(t.title)}`,
        'END:VEVENT'
      );
    }
    lines.push('END:VCALENDAR');
    const ics = lines.join('\r\n');

    res.setHeader('Content-Type','text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition','attachment; filename="calendar.ics"');
    return res.status(200).end(ics);
  }catch(e){
    res.setHeader('Content-Type','application/json; charset=utf-8');
    return res.status(500).end(JSON.stringify({ error: e.message }));
  }
};
