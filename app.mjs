#!/usr/bin/env node
// app.mjs v0.1.0
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  addUser, publicAccess, publicIdentity, publicServer, publicUser,
  removeAccess, removeIdentity, removeServer, saveAccess, saveIdentity, saveServer, updateUser,
} from "./admin.mjs";
import { hashToken, newId, passwordMatches, verifyTotp } from "./auth.mjs";
import { decideApproval, runtimeSnapshot, stopSession } from "./runtime.mjs";
import { scanHostKey, serverReachable } from "./ssh.mjs";
import { loadState, updateState } from "./state.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const sessions = new Map();
const setups = new Map();
const attempts = new Map();

function json(response, status, value, headers = {}) {
  const payload = JSON.stringify(value);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    ...headers,
  });
  response.end(payload);
}

function failure(response, status, message) { json(response, status, { error: message }); }

async function input(request) {
  if (!String(request.headers["content-type"] || "").startsWith("application/json")) throw Object.assign(new Error("Richiesta non valida."), { status: 415 });
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 160_000) throw Object.assign(new Error("Richiesta troppo grande."), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { throw Object.assign(new Error("Richiesta non valida."), { status: 400 }); }
}

function cookie(request, name) {
  for (const part of String(request.headers.cookie || "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return "";
}

function sessionUser(request, state) {
  const stored = sessions.get(hashToken(cookie(request, "puttit_admin")));
  if (!stored || stored.expires < Date.now()) return null;
  return state.users.find((user) => user.id === stored.userId && user.role === "admin" && !user.disabled) || null;
}

function sessionCookie(request, token, maxAge = 28_800) {
  return `puttit_admin=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${request.socket.encrypted ? "; Secure" : ""}`;
}

function allowLogin(key) {
  const cutoff = Date.now() - 10 * 60_000;
  const recent = (attempts.get(key) || []).filter((time) => time > cutoff);
  attempts.set(key, recent);
  return recent.length < 8;
}

function failedLogin(key) { attempts.set(key, [...(attempts.get(key) || []), Date.now()]); }

async function api(request, response, url) {
  if (request.method !== "POST") return failure(response, 404, "Operazione non disponibile.");
  const state = await loadState();

  if (url.pathname === "/auth/stato") return json(response, 200, { configurazione_richiesta: state.users.length === 0 });

  if (url.pathname === "/auth/configura") {
    if (state.users.length) return failure(response, 404, "Operazione non disponibile.");
    const data = await input(request);
    const pending = { users: [] };
    const user = await addUser(pending, data, "admin");
    const token = newId();
    setups.set(hashToken(token), { user, expires: Date.now() + 10 * 60_000 });
    const label = encodeURIComponent(`Puttit:${user.username}`);
    return json(response, 200, { token, secret: user.totp_secret, uri: `otpauth://totp/${label}?secret=${user.totp_secret}&issuer=Puttit` });
  }

  if (url.pathname === "/auth/conferma") {
    if (state.users.length) return failure(response, 404, "Operazione non disponibile.");
    const data = await input(request);
    const pending = setups.get(hashToken(String(data.token || "")));
    if (!pending || pending.expires < Date.now() || !verifyTotp(pending.user.totp_secret, String(data.code || ""))) return failure(response, 401, "Codice non valido.");
    await updateState((current) => {
      if (current.users.length) throw new Error("Configurazione già completata.");
      current.users.push(pending.user);
    });
    setups.delete(hashToken(data.token));
    return json(response, 200, { ok: true });
  }

  if (url.pathname === "/auth/accedi") {
    const data = await input(request);
    const key = `${request.socket.remoteAddress}:${String(data.username || "").toLowerCase()}`;
    if (!allowLogin(key)) return failure(response, 429, "Accesso temporaneamente sospeso.");
    const user = state.users.find((item) => item.username === String(data.username || "").trim().toLowerCase() && item.role === "admin" && !item.disabled);
    if (!user || !await passwordMatches(user, data.password) || !verifyTotp(user.totp_secret, String(data.code || ""))) {
      failedLogin(key);
      return failure(response, 401, "Accesso non valido.");
    }
    attempts.delete(key);
    const token = newId(24);
    sessions.set(hashToken(token), { userId: user.id, expires: Date.now() + 8 * 60 * 60_000 });
    return json(response, 200, { user: publicUser(user) }, { "Set-Cookie": sessionCookie(request, token) });
  }

  if (url.pathname === "/auth/esci") {
    sessions.delete(hashToken(cookie(request, "puttit_admin")));
    return json(response, 200, { ok: true }, { "Set-Cookie": sessionCookie(request, "", 0) });
  }

  const admin = sessionUser(request, state);
  if (!admin) return failure(response, 401, "Accesso richiesto.");

  if (url.pathname === "/admin/pannello") return json(response, 200, {
    admin: publicUser(admin),
    users: state.users.map(publicUser),
    servers: state.servers.map(publicServer),
    identities: state.identities.map(publicIdentity),
    accesses: state.accesses.map(publicAccess),
  });

  if (url.pathname === "/admin/monitoraggio") return json(response, 200, runtimeSnapshot());

  if (url.pathname === "/admin/richieste/decidi") {
    const data = await input(request);
    return json(response, 200, { request: decideApproval(data.id, data.approved === true) });
  }

  if (url.pathname === "/admin/sessioni/chiudi") {
    const data = await input(request);
    return json(response, 200, { session: stopSession(data.id) });
  }

  if (url.pathname === "/admin/utenti/crea") {
    const data = await input(request);
    const user = await updateState((current) => addUser(current, data));
    const label = encodeURIComponent(`Puttit:${user.username}`);
    return json(response, 200, { user: publicUser(user), secret: user.totp_secret, uri: `otpauth://totp/${label}?secret=${user.totp_secret}&issuer=Puttit` });
  }

  if (url.pathname === "/admin/utenti/aggiorna") {
    const data = await input(request);
    const user = await updateState((current) => updateUser(current, admin.id, data));
    if (user.disabled || user.role !== "admin") for (const [key, value] of sessions) if (value.userId === user.id) sessions.delete(key);
    return json(response, 200, { user: publicUser(user) });
  }

  if (url.pathname === "/admin/server/scansiona") {
    const data = await input(request);
    return json(response, 200, { fingerprint: await scanHostKey({ host: data.host, port: data.port }) });
  }

  if (url.pathname === "/admin/server/verifica") {
    const data = await input(request);
    const server = state.servers.find((item) => item.id === data.id);
    if (!server) return failure(response, 404, "Server non trovato.");
    return json(response, 200, { available: await serverReachable(server) });
  }

  if (url.pathname === "/admin/server/salva") {
    const data = await input(request);
    const server = await updateState((current) => saveServer(current, data));
    return json(response, 200, { server: publicServer(server) });
  }

  if (url.pathname === "/admin/server/elimina") {
    const data = await input(request);
    await updateState((current) => removeServer(current, data.id));
    return json(response, 200, { ok: true });
  }

  if (url.pathname === "/admin/identita/salva") {
    const data = await input(request);
    const identity = await updateState((current) => saveIdentity(current, data));
    return json(response, 200, { identity: publicIdentity(identity) });
  }

  if (url.pathname === "/admin/identita/elimina") {
    const data = await input(request);
    await updateState((current) => removeIdentity(current, data.id));
    return json(response, 200, { ok: true });
  }

  if (url.pathname === "/admin/accessi/salva") {
    const data = await input(request);
    const access = await updateState((current) => saveAccess(current, data));
    return json(response, 200, { access: publicAccess(access) });
  }

  if (url.pathname === "/admin/accessi/elimina") {
    const data = await input(request);
    await updateState((current) => removeAccess(current, data.id));
    return json(response, 200, { ok: true });
  }

  return failure(response, 404, "Operazione non disponibile.");
}

const staticFiles = new Map([
  ["/", ["public/index.html", "text/html; charset=utf-8"]],
  ["/app.css", ["public/app.css", "text/css; charset=utf-8"]],
  ["/admin.js", ["public/admin.js", "text/javascript; charset=utf-8"]],
]);

async function staticFile(response, pathname) {
  const file = staticFiles.get(pathname);
  if (!file) return false;
  const content = await readFile(join(root, file[0]));
  response.writeHead(200, {
    "Content-Type": file[1],
    "Content-Length": content.length,
    "Cache-Control": "no-cache",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  response.end(content);
  return true;
}

export function createApp() {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://puttit.local");
      if (url.pathname.startsWith("/auth/") || url.pathname.startsWith("/admin/")) return await api(request, response, url);
      if (request.method === "GET" && await staticFile(response, url.pathname)) return;
      failure(response, 404, "Risorsa non trovata.");
    } catch (error) {
      failure(response, error.status || 400, error.message || "Operazione non riuscita.");
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const host = process.env.PUTTIT_HOST || "127.0.0.1";
  const port = Number(process.env.PUTTIT_PORT || 11414);
  if (!["127.0.0.1", "::1", "localhost"].includes(host)) throw new Error("L'ascolto LAN sarà abilitato soltanto insieme a TLS.");
  createApp().listen(port, host, () => console.log(`Puttit admin: http://${host}:${port}`));
}
