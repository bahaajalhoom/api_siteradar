import { cookies } from "next/headers";
import { createHash, randomBytes } from "node:crypto";
import { db } from "./db";
import type { User } from "../lib/types";
import {cache} from 'react';
export const SESSION_COOKIE = "siteradar_session";
export const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export const currentUser=cache(async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const row = db
    .prepare(
      "SELECT users.id,users.email,users.name FROM sessions JOIN users ON sessions.user_id=users.id WHERE token_hash=? AND expires_at>?",
    )
    .get(tokenHash(token), Date.now());
  return row
    ? { id: String(row.id), name: String(row.name), email: String(row.email) }
    : null;
});
export function createSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  db.prepare("DELETE FROM sessions WHERE expires_at<?").run(Date.now());
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
    tokenHash(token),
    userId,
    Date.now() + 30 * 86400000,
  );
  return token;
}
export function allowAuthAttempt(ip: string) {
  const now = Date.now();
  const row = db
    .prepare("SELECT attempts,reset_at FROM auth_attempts WHERE ip=?")
    .get(ip);
  if (row && Number(row.reset_at) > now && Number(row.attempts) >= 20)
    return false;
  db.prepare(
    "INSERT INTO auth_attempts VALUES(?,1,?) ON CONFLICT(ip) DO UPDATE SET attempts=CASE WHEN reset_at<? THEN 1 ELSE attempts+1 END,reset_at=CASE WHEN reset_at<? THEN excluded.reset_at ELSE reset_at END",
  ).run(ip, now + 15 * 60_000, now, now);
  return true;
}
