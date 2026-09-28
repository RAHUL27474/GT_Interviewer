import fs from "node:fs/promises";
import path from "node:path";
import { getDatabasePool } from "../lib/database";

async function main() {
  const pool = getDatabasePool();
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const directory = path.join(process.cwd(), "db", "migrations");
    const files = (await fs.readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
    for (const file of files) {
      const exists = await client.query("SELECT 1 FROM schema_migrations WHERE version = $1", [file]);
      if (exists.rowCount) continue;
      await client.query("BEGIN");
      try {
        await client.query(await fs.readFile(path.join(directory, file), "utf8"));
        await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
        await client.query("COMMIT");
        console.info(`Applied ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Database migration failed:", err);
  process.exitCode = 1;
});