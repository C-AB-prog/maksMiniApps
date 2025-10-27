// /api/debug.js
import { Pool } from "pg";

const pool =
  global.pgPool ??
  new Pool({
    connectionString:
      process.env.POSTGRES_URL ||
      process.env.DATABASE_URL ||
      process.env.POSTGRES_PRISMA_URL,
    ssl: { rejectUnauthorized: false },
  });
if (!global.pgPool) global.pgPool = pool;

export default async function handler(req, res) {
  const what = (req.query.what || "").toString();

  try {
    if (what === "" || what === "ping") {
      return res.status(200).json({
        ok: true,
        note: "ping",
        env: process.env.NODE_ENV,
        region: process.env.VERCEL_REGION,
        time: new Date().toISOString(),
      });
    }

    if (what === "conn") {
      const { rows } = await pool.query("select now() as now");
      return res.status(200).json({ ok: true, now: rows?.[0]?.now });
    }

    if (what === "schema") {
      const tables = await pool.query(
        `select table_name
           from information_schema.tables
          where table_schema='public'
          order by 1`
      );
      const columns = await pool.query(
        `select table_name, column_name, data_type
           from information_schema.columns
          where table_schema='public'
          order by 1,2`
      );
      const counts = {};
      for (const t of tables.rows) {
        try {
          const c = await pool.query(`select count(*) from "${t.table_name}"`);
          counts[t.table_name] = Number(c.rows[0].count);
        } catch {}
      }
      return res
        .status(200)
        .json({ ok: true, tables: tables.rows.map(r => r.table_name), columns: columns.rows, counts });
    }

    if (what === "env") {
      return res.status(200).json({
        ok: true,
        env: process.env.NODE_ENV,
        region: process.env.VERCEL_REGION,
        flags: {
          POSTGRES_URL: !!process.env.POSTGRES_URL,
          DATABASE_URL: !!process.env.DATABASE_URL,
          POSTGRES_PRISMA_URL: !!process.env.POSTGRES_PRISMA_URL,
        },
      });
    }

    return res.status(404).json({ ok: false, error: "Not found", what });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
