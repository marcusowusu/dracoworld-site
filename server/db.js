import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set before the authentication server starts.");
}

const maxPoolSize = Number(process.env.DB_POOL_MAX || "10");
if (!Number.isInteger(maxPoolSize) || maxPoolSize < 1 || maxPoolSize > 100) {
  throw new Error("DB_POOL_MAX must be an integer between 1 and 100.");
}

const databaseSsl = process.env.DATABASE_SSL || "false";
if (!["true", "false"].includes(databaseSsl)) {
  throw new Error("DATABASE_SSL must be set to true or false.");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: maxPoolSize,
  ssl: databaseSsl === "true" ? { rejectUnauthorized: true } : undefined,
});

export async function inTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
