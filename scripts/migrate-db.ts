/**
 * Run all SQL files in `db/migrations` in alphabetical order.
 * Run from the project root: npm run db:migrate
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";
import { Pool } from "pg";

const root = process.cwd();

config({ path: join(root, ".env") });
config({ path: join(root, ".env.local"), override: true });

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("migrate-db: DATABASE_URL is not set.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url });

  const migrationsDir = join(root, "db", "migrations");
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b, "en"));

  if (files.length === 0) {
    console.error("migrate-db: no .sql files in db/migrations");
    await pool.end();
    process.exit(1);
  }

  const client = await pool.connect();
  let failed = false;
  try {
    for (const file of files) {
      const full = join(migrationsDir, file);
      const sql = readFileSync(full, "utf8");
      console.log(`Running migration: ${file} …`);
      await client.query(sql);
      console.log(`  OK: ${file}`);
    }
    console.log("Migrations completed successfully.");
  } catch (e) {
    failed = true;
    console.error("migrate-db: migration failed:", e);
  } finally {
    client.release();
    await pool.end();
  }
  if (failed) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("migrate-db: fatal error:", e);
  process.exit(1);
});
