import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { db } from "./db.ts";
function key() {
  const path = resolve("data/.secrets-key");
  if (!existsSync(path)) {
    try {
      writeFileSync(path, randomBytes(32), { mode: 0o600, flag: "wx" });
    } catch (e) {
      if (!existsSync(path)) throw e;
    }
  }
  return readFileSync(path);
}
export function saveSecret(ownerId: string, provider: string, value: string) {
  if (!value) {
    db.prepare("DELETE FROM secrets WHERE owner_id=? AND provider=?").run(
      ownerId,
      provider,
    );
    return;
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const packed = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
    "base64",
  );
  db.prepare(
    "INSERT INTO secrets VALUES(?,?,?) ON CONFLICT(owner_id,provider) DO UPDATE SET encrypted=excluded.encrypted",
  ).run(ownerId, provider, packed);
}
export function getSecret(ownerId: string, provider: string) {
  const row = db
    .prepare("SELECT encrypted FROM secrets WHERE owner_id=? AND provider=?")
    .get(ownerId, provider);
  if (!row)
    return provider === "serpapi" ? (process.env.SERPAPI_API_KEY ?? "") : "";
  const packed = Buffer.from(String(row.encrypted), "base64");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(),
    packed.subarray(0, 12),
  );
  decipher.setAuthTag(packed.subarray(12, 28));
  return Buffer.concat([
    decipher.update(packed.subarray(28)),
    decipher.final(),
  ]).toString("utf8");
}
