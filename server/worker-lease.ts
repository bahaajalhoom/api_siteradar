import { db } from "./db.ts";
db.exec(
  "CREATE TABLE IF NOT EXISTS worker_lease(id INTEGER PRIMARY KEY,owner TEXT NOT NULL,pid INTEGER NOT NULL,expires_at INTEGER NOT NULL)",
);
const owner = crypto.randomUUID();
function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}
export function acquireWorkerLease() {
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare("SELECT * FROM worker_lease WHERE id=1").get();
    if (
      row &&
      row.owner !== owner &&
      Number(row.expires_at) > Date.now() &&
      alive(Number(row.pid))
    ) {
      db.exec("COMMIT");
      return false;
    }
    db.prepare(
      "INSERT INTO worker_lease VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,pid=excluded.pid,expires_at=excluded.expires_at",
    ).run(owner, process.pid, Date.now() + 45000);
    db.exec("COMMIT");
    return true;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export function renewWorkerLease() {
  db.prepare("UPDATE worker_lease SET expires_at=? WHERE id=1 AND owner=?").run(
    Date.now() + 45000,
    owner,
  );
}
export function releaseWorkerLease() {
  db.prepare("DELETE FROM worker_lease WHERE id=1 AND owner=?").run(owner);
}
