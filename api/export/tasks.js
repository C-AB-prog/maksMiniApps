const { getOrCreateUser, sendJSON } = require('../_utils');
const { pool, ensureSchema, upsertUser } = require('../_db');

function toCSV(rows){
  const cols = ['id','parent_id','title','notes','scope','priority','done','due_at','remind_at','created_at','updated_at'];
  const esc = v => {
    if (v==null) return '';
    const s = String(v).replace(/"/g,'""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };
  const head = cols.join(',');
  const body = rows.map(r=> cols.map(c=> esc(r[c])).join(',')).join('\n');
  return head+'\n'+body+'\n';
}

module.exports = async (req,res)=>{
  try{
    const qs = (()=>{ try{ return new URL(req.url,'http://x').searchParams }catch{ return new URLSearchParams() } })();
    const format = (qs.get('format')||'json').toLowerCase();
    const tz = qs.get('tz') || null;

    const { user } = getOrCreateUser(req,res);
    await ensureSchema(); await upsertUser(user, tz);

    const { rows } = await pool.query(
      `SELECT id,parent_id,title,notes,scope,priority,done,
              to_char(due_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') as due_at,
              to_char(remind_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') as remind_at,
              to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at,
              to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') as updated_at
         FROM tasks WHERE user_id=$1 ORDER BY created_at DESC`, [user.id]);

    if(format==='csv'){
      const csv = toCSV(rows);
      res.setHeader('Content-Type','text/csv; charset=utf-8');
      res.setHeader('Content-Disposition','attachment; filename="tasks.csv"');
      return res.status(200).end(csv);
    }

    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.setHeader('Content-Disposition','attachment; filename="tasks.json"');
    return res.status(200).end(JSON.stringify({ tasks: rows }, null, 2));
  }catch(e){ return sendJSON(res,500,{error:e.message}); }
};
