import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Audit } from "../lib/types";
import type { Project } from '../lib/types';
import { withResourceIds } from './resource-ids.ts';
mkdirSync(resolve("data"), { recursive: true });
const globalDb = globalThis as typeof globalThis & { radarDb?: DatabaseSync };
export const db =
  globalDb.radarDb ?? new DatabaseSync(resolve("data/siteradar.sqlite"));
globalDb.radarDb = db;
db.exec(
  "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS audits (id TEXT PRIMARY KEY, status TEXT NOT NULL, created_at TEXT NOT NULL, body TEXT NOT NULL);",
);
if (
  !db
    .prepare("PRAGMA table_info(audits)")
    .all()
    .some((c) => c.name === "owner_id")
)
  db.exec("ALTER TABLE audits ADD COLUMN owner_id TEXT;");
db.exec(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password_hash TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,origin TEXT NOT NULL,name TEXT NOT NULL,config TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(owner_id,origin));
CREATE TABLE IF NOT EXISTS secrets(owner_id TEXT NOT NULL,provider TEXT NOT NULL,encrypted TEXT NOT NULL,PRIMARY KEY(owner_id,provider));
CREATE TABLE IF NOT EXISTS auth_attempts(ip TEXT PRIMARY KEY,attempts INTEGER NOT NULL,reset_at INTEGER NOT NULL);`);
export function saveAudit(audit: Audit) {
  audit=withResourceIds(audit);
  db.prepare(
    "INSERT INTO audits (id,status,created_at,body,owner_id) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,body=excluded.body,owner_id=excluded.owner_id",
  ).run(
    audit.id,
    audit.status,
    audit.createdAt,
    JSON.stringify(audit),
    audit.ownerId ?? null,
  );
}
export function getAudit(id: string): Audit | null {
  const row = db.prepare("SELECT body FROM audits WHERE id=?").get(id);
  return row ? withResourceIds(JSON.parse(String(row.body)) as Audit) : null;
}
export function listAudits(ownerId?: string): Audit[] {
  return db
    .prepare(
      ownerId
        ? "SELECT body FROM audits WHERE owner_id=? ORDER BY created_at DESC"
        : "SELECT body FROM audits ORDER BY created_at DESC",
    )
    .all(...(ownerId ? [ownerId] : []))
    .map((row) => withResourceIds(JSON.parse(String(row.body)) as Audit));
}
function projectFromRow(row:Record<string,unknown>):Project{return {id:String(row.id),name:String(row.name),origin:String(row.origin),config:JSON.parse(String(row.config)),createdAt:String(row.created_at)};}
export function listProjects(ownerId:string){return db.prepare('SELECT * FROM projects WHERE owner_id=? ORDER BY created_at DESC').all(ownerId).map(projectFromRow);}
export function getProject(id:string,ownerId:string){const row=db.prepare('SELECT * FROM projects WHERE id=? AND owner_id=?').get(id,ownerId);return row?projectFromRow(row):null;}
export function saveProject(ownerId: string, config: Audit["config"]) {
  const origin = new URL(config.url).origin;
  const existing = db
    .prepare("SELECT id FROM projects WHERE owner_id=? AND origin=?")
    .get(ownerId, origin);
  const id = existing ? String(existing.id) : crypto.randomUUID();
  db.prepare(
    "INSERT INTO projects(id,owner_id,origin,name,config,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(owner_id,origin) DO UPDATE SET config=excluded.config",
  ).run(
    id,
    ownerId,
    origin,
    new URL(origin).hostname,
    JSON.stringify(config),
    new Date().toISOString(),
  );
  return id;
}
export function importLegacy(ownerId: string) {
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of db
      .prepare("SELECT body FROM audits WHERE owner_id IS NULL")
      .all()) {
      const a = JSON.parse(String(row.body)) as Audit;
      a.ownerId = ownerId;
      a.projectId = saveProject(ownerId, a.config);
      saveAudit(a);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export function claimAudit(): Audit | null {
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db
      .prepare(
        "SELECT body FROM audits WHERE status='queued' ORDER BY created_at LIMIT 1",
      )
      .get();
    if (!row) {
      db.exec("COMMIT");
      return null;
    }
    const audit = JSON.parse(String(row.body)) as Audit;
    audit.status = "running";
    saveAudit(audit);
    db.exec("COMMIT");
    return audit;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
