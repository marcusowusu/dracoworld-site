import "dotenv/config";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { pool, inTransaction } from "./db.js";

const migrationDirectory = fileURLToPath(new URL("../migrations/", import.meta.url));

try {
  await inTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(1146309700, 1)");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const migrationName = "001_initial_auth.sql";
    const existing = await client.query(
      "SELECT 1 FROM schema_migrations WHERE name = $1",
      [migrationName],
    );

    if (existing.rowCount === 0) {
      const migration = await readFile(path.join(migrationDirectory, migrationName), "utf8");
      await client.query(migration);
      await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [migrationName]);
      console.info(`Applied ${migrationName}`);
    } else {
      console.info("Database migrations are up to date.");
    }
  });
} catch (error) {
  console.error("Database migration failed:", error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
