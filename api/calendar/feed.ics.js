// api/calendar/feed.ics.js
import { ensureSchema, q } from '../_db.js';
import { getTgId, getOrCreateUserId } from '../_utils.js';

function esc(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function toIcsDate(ms) {
  const d = new Date(Number(ms));
  if (Number.isNaN(d.getTime())) return null;
  // UTC формат: YYYYMMDDTHHMMSSZ
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    'Z'
  );
}

export default async function handler(req, res) {
  await ensureSchema();

  const tgId = getTgId(req);
  if (!tgId) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(400).send('tg_id required');
  }

  const userId = await getOrCreateUserId(tgId);

  // берём задачи со сроком, которые видны пользователю
  const { rows } = await q(
    `
    SELECT id, title, due_ts, is_done
    FROM tasks
    WHERE due_ts IS NOT NULL
      AND (
        (team_id IS NULL AND user_id = $1)
        OR (assigned_to_user_id = $1)
        OR (
          team_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM team_members m WHERE m.team_id = tasks.team_id AND m.user_id = $1
          )
          AND (
            assigned_to_user_id IS NULL
            OR assigned_to_user_id = $1
            OR (
              (SELECT m2.user_id
               FROM team_members m2
               WHERE m2.team_id = tasks.team_id
               ORDER BY m2.joined_at ASC
               LIMIT 1
              ) = $1
            )
          )
        )
      )
    ORDER BY due_ts ASC
    LIMIT 500
    `,
    [userId]
  );

  const now = new Date();
  const dtstamp = toIcsDate(now.getTime());

  let ics = '';
  ics += 'BEGIN:VCALENDAR\n';
  ics += 'VERSION:2.0\n';
  ics += 'PRODID:-//Growth Assistant//Tasks Calendar//RU\n';
  ics += 'CALSCALE:GREGORIAN\n';
  ics += 'METHOD:PUBLISH\n';

  for (const t of rows) {
    const dt = toIcsDate(t.due_ts);
    if (!dt) continue;

    const uid = `task-${t.id}-tg-${tgId}@growth-assistant`;
    const summary = (t.is_done ? '✅ ' : '📝 ') + String(t.title || '').slice(0, 160);

    // Сделаем событие длительностью 15 минут (чтобы было видно)
    // DTSTART=due_ts, DTEND=due_ts+15min
    const dtend = toIcsDate(Number(t.due_ts) + 15 * 60 * 1000);

    ics += 'BEGIN:VEVENT\n';
    ics += `UID:${esc(uid)}\n`;
    ics += `DTSTAMP:${dtstamp}\n`;
    ics += `DTSTART:${dt}\n`;
    ics += `DTEND:${dtend}\n`;
    ics += `SUMMARY:${esc(summary)}\n`;
    ics += `DESCRIPTION:${esc('Задача из Growth Assistant')}\n`;
    ics += 'END:VEVENT\n';
  }

  ics += 'END:VCALENDAR\n';

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).send(ics);
}
