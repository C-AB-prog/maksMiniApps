// api/notify/_digest.js (CommonJS)

function escapeHtml(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

// Format timestamp (ms UTC) as local time using only tz offset (minutes)
// Example: "26.12 18:00"
function fmtLocalDMHM(msUtc, tzOffsetMin) {
  const d = new Date(Number(msUtc) - Number(tzOffsetMin) * 60 * 1000);
  return `${pad2(d.getUTCDate())}.${pad2(d.getUTCMonth() + 1)} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

// Example: "18:00"
function fmtLocalHM(msUtc, tzOffsetMin) {
  const d = new Date(Number(msUtc) - Number(tzOffsetMin) * 60 * 1000);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

// Returns UTC bounds (ms) for "today" in the user's local time
function getDayBoundsUtc(nowMs, tzOffsetMin) {
  const local = new Date(Number(nowMs) - Number(tzOffsetMin) * 60 * 1000);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const d = local.getUTCDate();

  const startUtcMs = Date.UTC(y, m, d, 0, 0, 0, 0) + Number(tzOffsetMin) * 60 * 1000;
  const endUtcMs = startUtcMs + 24 * 60 * 60 * 1000 - 1;
  return { startUtcMs, endUtcMs };
}

function dueBadge(dueTs, bounds, tzOffsetMin) {
  if (dueTs == null) return 'без срока';
  const ms = Number(dueTs);
  if (!Number.isFinite(ms)) return 'без срока';
  if (ms >= bounds.startUtcMs && ms <= bounds.endUtcMs) {
    return `до ${fmtLocalHM(ms, tzOffsetMin)}`;
  }
  return `до ${fmtLocalDMHM(ms, tzOffsetMin)}`;
}

function overdueBadge(dueTs, tzOffsetMin) {
  if (dueTs == null) return 'без срока';
  const ms = Number(dueTs);
  if (!Number.isFinite(ms)) return 'без срока';
  return `должно было быть до ${fmtLocalDMHM(ms, tzOffsetMin)}`;
}

async function buildDigestText({ query, userId, tzOffsetMin, nowMs }) {
  const bounds = getDayBoundsUtc(nowMs, tzOffsetMin);

  const focusRes = await query(
    `SELECT text FROM focuses WHERE user_id=$1 ORDER BY id DESC LIMIT 1`,
    [userId]
  );
  const focusText = (focusRes.rows[0]?.text || '').trim();

  const myRes = await query(
    `
    SELECT id, title, due_ts
    FROM tasks
    WHERE is_done = false
      AND team_id IS NULL
      AND user_id = $1
      AND ( (due_ts BETWEEN $2 AND $3) OR due_ts IS NULL )
    ORDER BY (due_ts IS NULL) ASC, due_ts ASC NULLS LAST, id DESC
    LIMIT 50
    `,
    [userId, bounds.startUtcMs, bounds.endUtcMs]
  );

  const teamRes = await query(
    `
    SELECT t.id, t.title, t.due_ts, t.team_id, t.assigned_to_user_id, tm.name AS team_name
    FROM tasks t
    JOIN team_members m ON m.team_id = t.team_id AND m.user_id = $1
    JOIN teams tm ON tm.id = t.team_id
    WHERE t.is_done = false
      AND t.team_id IS NOT NULL
      AND (t.assigned_to_user_id IS NULL OR t.assigned_to_user_id = $1)
      AND ( (t.due_ts BETWEEN $2 AND $3) OR t.due_ts IS NULL )
    ORDER BY (t.due_ts IS NULL) ASC, t.due_ts ASC NULLS LAST, t.id DESC
    LIMIT 50
    `,
    [userId, bounds.startUtcMs, bounds.endUtcMs]
  );

  const overdueMyRes = await query(
    `
    SELECT id, title, due_ts
    FROM tasks
    WHERE is_done = false
      AND team_id IS NULL
      AND user_id = $1
      AND due_ts IS NOT NULL
      AND due_ts < $2
    ORDER BY due_ts ASC
    LIMIT 50
    `,
    [userId, nowMs]
  );

  const overdueTeamRes = await query(
    `
    SELECT t.id, t.title, t.due_ts, tm.name AS team_name, t.assigned_to_user_id
    FROM tasks t
    JOIN team_members m ON m.team_id = t.team_id AND m.user_id = $1
    JOIN teams tm ON tm.id = t.team_id
    WHERE t.is_done = false
      AND t.team_id IS NOT NULL
      AND (t.assigned_to_user_id IS NULL OR t.assigned_to_user_id = $1)
      AND t.due_ts IS NOT NULL
      AND t.due_ts < $2
    ORDER BY t.due_ts ASC
    LIMIT 50
    `,
    [userId, nowMs]
  );

  const myTasks = myRes.rows || [];
  const teamTasks = teamRes.rows || [];
  const overdueMy = overdueMyRes.rows || [];
  const overdueTeam = overdueTeamRes.rows || [];

  const lines = [];

  // Focus
  lines.push(`🎯 Фокус: ${focusText ? `«${escapeHtml(focusText)}»` : '(не задан)'}`);
  lines.push('');

  // My today
  lines.push(`🧍 Мои задачи сегодня (${myTasks.length}):`);
  lines.push('');
  if (!myTasks.length) {
    lines.push('Нет задач');
  } else {
    const max = 10;
    myTasks.slice(0, max).forEach((t, i) => {
      const ttl = escapeHtml(t.title);
      lines.push(`${ttl} (${dueBadge(t.due_ts, bounds, tzOffsetMin)})`);
      // spaced lines like in your example
      if (i !== Math.min(max, myTasks.length) - 1) lines.push('');
    });
    if (myTasks.length > max) {
      lines.push('');
      lines.push(`…ещё ${myTasks.length - max}`);
    }
  }

  lines.push('');
  lines.push('');

  // Team today
  lines.push(`👥 Командные задачи сегодня (${teamTasks.length}):`);
  if (!teamTasks.length) {
    lines.push('• Нет командных задач');
  } else {
    const max = 10;
    teamTasks.slice(0, max).forEach((t) => {
      const teamName = escapeHtml(t.team_name || 'Команда');
      const ttl = escapeHtml(t.title);
      const who = t.assigned_to_user_id ? 'тебе' : 'всем';
      lines.push(`• [${teamName}] ${ttl} (${dueBadge(t.due_ts, bounds, tzOffsetMin)}) — ${who}`);
    });
    if (teamTasks.length > max) lines.push(`…ещё ${teamTasks.length - max}`);
  }

  // Overdue block at bottom
  const overdueTotal = overdueMy.length + overdueTeam.length;
  if (overdueTotal) {
    lines.push('');
    lines.push('');
    lines.push(`⛔ Просроченные (${overdueTotal}):`);

    const max = 12;
    const merged = [];
    overdueMy.forEach(t => merged.push({ kind: 'my', ...t }));
    overdueTeam.forEach(t => merged.push({ kind: 'team', ...t }));
    merged.sort((a, b) => Number(a.due_ts) - Number(b.due_ts));

    merged.slice(0, max).forEach((t) => {
      const ttl = escapeHtml(t.title);
      if (t.kind === 'team') {
        const teamName = escapeHtml(t.team_name || 'Команда');
        const who = t.assigned_to_user_id ? 'тебе' : 'всем';
        lines.push(`• [${teamName}] ${ttl} (${overdueBadge(t.due_ts, tzOffsetMin)}) — ${who}`);
      } else {
        lines.push(`• (личное) ${ttl} (${overdueBadge(t.due_ts, tzOffsetMin)})`);
      }
    });

    if (merged.length > max) lines.push(`…ещё ${merged.length - max}`);
  }

  return lines.join('\n');
}

module.exports = {
  escapeHtml,
  fmtLocalDMHM,
  fmtLocalHM,
  getDayBoundsUtc,
  buildDigestText,
};
