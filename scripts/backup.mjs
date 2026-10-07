// Copies the database to data/backups/ using SQLite's online backup, which is safe while the app is running.
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const src = path.resolve(process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "app.db"));
if (!fs.existsSync(src)) {
  console.error(`No database at ${src}. Nothing to back up.`);
  process.exit(1);
}
const dir = path.join(path.dirname(src), "backups");
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const dest = path.join(dir, `app-${stamp}.db`);

const db = new Database(src, { readonly: true, fileMustExist: true });
try {
  await db.backup(dest);
  console.log(`Backed up to ${dest}`);
} finally {
  db.close();
}
