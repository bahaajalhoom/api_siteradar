import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { db, getAudit, listAudits, saveAudit, saveProject } from "./db.ts";
import { hashPassword, verifyPassword } from "./passwords.ts";
import { getSecret, saveSecret } from "./secrets.ts";
import { auditInput } from "./contracts.ts";
import { validateTarget } from "./safe-fetch.ts";
import type { Audit } from "../lib/types.ts";

const port = Number(process.env.PORT || 3000);
const allowedOrigins = new Set([
  "https://siteradar.site",
  "https://www.siteradar.site",
  "http://127.0.0.1:3001",
  "http://localhost:3001",
  ...(process.env.FRONTEND_ORIGIN || "").split(",").map(value => value.trim()).filter(Boolean),
]);
const sessionCookie = "siteradar_session";
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
function json(res: ServerResponse, status: number, value: unknown) { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(value)); }
function addCors(req: IncomingMessage, res: ServerResponse) {
  if (req.headers.origin && allowedOrigins.has(req.headers.origin)) { res.setHeader("Access-Control-Allow-Origin", req.headers.origin); res.setHeader("Access-Control-Allow-Credentials", "true"); res.setHeader("Vary", "Origin"); }
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization"); res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
}
function cookie(req: IncomingMessage, name: string) { return req.headers.cookie?.split(";").map(x => x.trim()).find(x => x.startsWith(`${name}=`))?.slice(name.length + 1); }
function currentUser(req: IncomingMessage) {
  const bearer = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : undefined;
  const token = bearer || cookie(req, sessionCookie); if (!token) return null;
  const row = db.prepare("SELECT users.id,users.email,users.name FROM sessions JOIN users ON sessions.user_id=users.id WHERE token_hash=? AND expires_at>?").get(tokenHash(token), Date.now()) as Record<string, unknown> | undefined;
  return row ? { id: String(row.id), email: String(row.email), name: String(row.name) } : null;
}
async function readBody(req: IncomingMessage) { const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk)); const raw = Buffer.concat(chunks).toString("utf8"); if (raw.length > 64000) throw new Error("Request body is too large."); return raw ? JSON.parse(raw) : {}; }
function unauthorized(res: ServerResponse) { return json(res, 401, { error: "Sign in required." }); }
function issueSession(res: ServerResponse, userId: string) { const token = randomBytes(32).toString("hex"); db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(tokenHash(token), userId, Date.now() + 30 * 86400000); res.setHeader("Set-Cookie", `${sessionCookie}=${token}; HttpOnly; SameSite=None; Secure; Path=/; Max-Age=2592000`); }

const worker = spawn(process.execPath, [fileURLToPath(new URL("./worker.ts", import.meta.url))], { stdio: "inherit", env: process.env });
let shuttingDown = false;
worker.on("exit", code => { if (!shuttingDown && code) console.error(`Worker exited with ${code}.`); });

const server = createServer(async (req, res) => {
  addCors(req, res);
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  try {
    if (req.method === "GET" && ["/", "/health"].includes(url.pathname)) return json(res, 200, { ok: true, service: "api_siteradar" });
    if (url.pathname === "/api/auth/session" && req.method === "GET") return json(res, 200, { data: currentUser(req) });
    if (url.pathname === "/api/auth/sign-out" && req.method === "POST") { const token = req.headers.authorization?.slice(7) || cookie(req, sessionCookie); if (token) db.prepare("DELETE FROM sessions WHERE token_hash=?").run(tokenHash(token)); res.setHeader("Set-Cookie", `${sessionCookie}=; HttpOnly; SameSite=None; Secure; Path=/; Max-Age=0`); return json(res, 200, { ok: true }); }
    if (["/api/auth/sign-in", "/api/auth/sign-up"].includes(url.pathname) && req.method === "POST") {
      const input = await readBody(req); const email = String(input.email || "").trim().toLowerCase(); const password = String(input.password || "");
      if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 10) return json(res, 400, { error: "Enter a valid email and a password of at least 10 characters." });
      let found = db.prepare("SELECT * FROM users WHERE email=?").get(email) as Record<string, unknown> | undefined;
      if (url.pathname.endsWith("sign-up")) { if (found) return json(res, 409, { error: "An account with this email already exists." }); if (String(input.name || "").trim().length < 2) return json(res, 400, { error: "Enter your name." }); const id = crypto.randomUUID(); db.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(id, email, String(input.name).trim(), await hashPassword(password), new Date().toISOString()); found = { id, email, name: String(input.name).trim() }; }
      else if (!found || !(await verifyPassword(password, String(found.password_hash)))) return json(res, 401, { error: "Email or password is incorrect." });
      const data = { id: String(found.id), email: String(found.email), name: String(found.name) }; issueSession(res, data.id); return json(res, 200, { data });
    }
    const current = currentUser(req);
    if (url.pathname === "/api/audits" && req.method === "GET") return current ? json(res, 200, { data: listAudits(current.id) }) : unauthorized(res);
    if (url.pathname === "/api/audits" && req.method === "POST") {
      if (!current) return unauthorized(res); const parsed = auditInput.safeParse(await readBody(req)); if (!parsed.success) return json(res, 400, { error: parsed.error.issues[0]?.message || "Invalid audit configuration." }); validateTarget(parsed.data.url); const projectId = saveProject(current.id, parsed.data);
      const active = listAudits(current.id).find(a => a.projectId === projectId && ["queued", "running"].includes(a.status)); if (active) return json(res, 200, { data: active });
      const audit: Audit = { id: crypto.randomUUID(), ownerId: current.id, projectId, name: new URL(parsed.data.url).hostname, url: parsed.data.url, config: parsed.data, status: "queued", createdAt: new Date().toISOString(), score: null, scores: [], pages: [], findings: [], events: [{ time: new Date().toISOString(), message: "Scan queued. Waiting for the worker." }] }; saveAudit(audit); return json(res, 201, { data: audit });
    }
    const match = url.pathname.match(/^\/api\/audits\/([^/]+)$/);
    if (match && ["GET", "PATCH"].includes(req.method || "")) { if (!current) return unauthorized(res); const audit = getAudit(match[1]); if (!audit || audit.ownerId !== current.id) return json(res, 404, { error: "Scan not found." }); if (req.method === "PATCH" && ["queued", "running"].includes(audit.status)) { audit.status = "cancelled"; audit.events.push({ time: new Date().toISOString(), message: "Cancellation requested." }); saveAudit(audit); } return json(res, 200, { data: audit }); }
    if (url.pathname === "/api/integrations" && req.method === "GET") return current ? json(res, 200, { data: { serpapi: !!getSecret(current.id, "serpapi"), browser: true, plan: "free", unlimited: true } }) : unauthorized(res);
    if (url.pathname === "/api/integrations" && req.method === "POST") { if (!current) return unauthorized(res); const input = await readBody(req); if (input.provider !== "serpapi" || typeof input.key !== "string" || input.key.length > 512) return json(res, 400, { error: "Invalid provider key." }); saveSecret(current.id, "serpapi", input.key.trim()); return json(res, 200, { ok: true }); }
    return json(res, 404, { error: "Not found" });
  } catch (error) { return json(res, 400, { error: error instanceof Error ? error.message : "Request failed." }); }
});
function shutdown() { if (shuttingDown) return; shuttingDown = true; worker.kill("SIGTERM"); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); }
process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown); server.listen(port, "0.0.0.0", () => console.log(`SiteRadar API listening on port ${port}`));
