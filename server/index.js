import "dotenv/config";
import app from "./app.js";
import { pool } from "./db.js";

const port = Number(process.env.PORT || "3000");
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

try {
  await pool.query("SELECT 1");
} catch (error) {
  console.error("Database connection failed:", error.message);
  process.exit(1);
}

const server = app.listen(port, () => {
  console.info(`DracoWorld server listening on port ${port}.`);
});

const cleanupTimer = setInterval(() => {
  pool.query(`
    UPDATE invitations SET status = 'expired'
    WHERE status = 'pending' AND expires_at <= now();
    DELETE FROM sessions WHERE expires_at <= now();
    DELETE FROM email_verification_tokens WHERE expires_at <= now() OR consumed_at IS NOT NULL;
    DELETE FROM password_reset_tokens WHERE expires_at <= now() OR consumed_at IS NOT NULL;
    DELETE FROM auth_rate_limits WHERE expires_at <= now()
  `).catch((error) => {
    console.error("Expired-record cleanup failed:", error.message);
  });
}, 60 * 60 * 1000);
cleanupTimer.unref();

async function shutdown() {
  clearInterval(cleanupTimer);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
