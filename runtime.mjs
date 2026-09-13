// runtime.mjs v0.1.0
import { newId } from "./auth.mjs";

const pending = new Map();
const active = new Map();
const timers = new Map();
const alertListeners = new Set();

function alert(type, details) {
  const event = { type, at: Date.now(), user_name: details.user_name, server_name: details.server_name };
  for (const listener of alertListeners) try { listener(event); } catch {}
}

export function onAlert(listener) {
  alertListeners.add(listener);
  return () => alertListeners.delete(listener);
}

function clean() {
  const now = Date.now();
  for (const [id, request] of pending) if (request.expires_at <= now) pending.delete(id);
}

function publicRequest(request) {
  return { id: request.id, access_id: request.access_id, user_id: request.user_id, user_name: request.user_name, server_name: request.server_name, requested_at: request.requested_at, expires_at: request.expires_at, status: request.status };
}

function publicSession(session) {
  return { id: session.id, access_id: session.access_id, user_id: session.user_id, user_name: session.user_name, server_name: session.server_name, started_at: session.started_at, status: session.status };
}

export function requestApproval(details, minutes = 5) {
  clean();
  const duplicate = [...pending.values()].find((item) => item.access_id === details.access_id && item.user_id === details.user_id && item.status === "pending");
  if (duplicate) return publicRequest(duplicate);
  const now = Date.now();
  const request = { id: newId(12), ...details, requested_at: now, expires_at: now + Math.min(Math.max(minutes, 1), 10) * 60_000, status: "pending" };
  pending.set(request.id, request);
  alert("approval_requested", request);
  return publicRequest(request);
}

export function decideApproval(id, approved) {
  clean();
  const request = pending.get(id);
  if (!request || request.status !== "pending") throw new Error("Richiesta non disponibile.");
  request.status = approved ? "approved" : "rejected";
  request.expires_at = Date.now() + 60_000;
  return publicRequest(request);
}

export function consumeApproval(id, userId) {
  clean();
  const request = pending.get(id);
  if (!request || request.user_id !== userId) throw new Error("Richiesta non disponibile.");
  if (request.status === "pending") return { status: "pending" };
  pending.delete(id);
  return { status: request.status };
}

export function registerSession(details, close, maxMinutes) {
  const minutes = maxMinutes === undefined ? undefined : Number(maxMinutes);
  if (minutes !== undefined && (!Number.isInteger(minutes) || minutes < 1 || minutes > 600)) throw new Error("Durata sessione non valida.");
  const session = { id: newId(12), ...details, started_at: Date.now(), status: "active", close };
  active.set(session.id, session);
  alert("session_started", session);
  if (minutes !== undefined) timers.set(session.id, setTimeout(() => stopSession(session.id, "expired"), minutes * 60_000).unref());
  return publicSession(session);
}

export function finishSession(id) {
  active.delete(id);
  clearTimeout(timers.get(id));
  timers.delete(id);
}

export function stopSession(id, reason = "closed_by_admin") {
  const session = active.get(id);
  if (!session || session.status !== "active") throw new Error("Sessione non disponibile.");
  session.status = reason;
  alert("session_stopped", session);
  session.close(reason);
  return publicSession(session);
}

export function runtimeSnapshot() {
  clean();
  return { requests: [...pending.values()].filter((item) => item.status === "pending").map(publicRequest), sessions: [...active.values()].map(publicSession) };
}

export function clearRuntime() {
  for (const timer of timers.values()) clearTimeout(timer);
  pending.clear(); active.clear(); timers.clear();
}
