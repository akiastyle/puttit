// admin.mjs v0.1.0
import { newId, passwordRecord, totpSecret } from "./auth.mjs";
import { normalizeFingerprint } from "./ssh.mjs";

function text(value, label, max = 120) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new Error(`${label} non valido.`);
  return value.trim();
}

function role(value) {
  if (!["admin", "user", "guest"].includes(value)) throw new Error("Ruolo non valido.");
  return value;
}

function guestPolicy(input, current) {
  const mode = input.guest_mode || current?.mode || "approval";
  if (mode === "approval") return { mode };
  if (mode !== "duration") throw new Error("Controllo guest non valido.");
  const minutes = Number(input.guest_minutes ?? current?.minutes);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 600) throw new Error("La durata guest deve essere compresa tra 1 minuto e 10 ore.");
  return { mode, minutes };
}

function username(value) {
  const result = text(value, "Nome utente", 32).toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(result)) throw new Error("Nome utente non valido.");
  return result;
}

export function publicUser(user) {
  return { id: user.id, name: user.name, username: user.username, role: user.role, disabled: Boolean(user.disabled), ...(user.role === "guest" ? { guest_policy: user.guest_policy || { mode: "approval" } } : {}) };
}

export async function addUser(state, input, forcedRole) {
  const login = username(input.username);
  if (state.users.some((user) => user.username === login)) throw new Error("Nome utente già presente.");
  const selectedRole = forcedRole || role(input.role);
  const user = {
    id: newId(12), name: text(input.name, "Nome"), username: login, role: selectedRole, disabled: false,
    totp_secret: totpSecret(), ...await passwordRecord(input.password),
    ...(selectedRole === "guest" ? { guest_policy: guestPolicy(input) } : {}),
  };
  state.users.push(user);
  return user;
}

export function updateUser(state, actorId, input) {
  const user = state.users.find((item) => item.id === input.id);
  if (!user) throw new Error("Utente non trovato.");
  if (input.role !== undefined) user.role = role(input.role);
  if (user.role === "guest") user.guest_policy = guestPolicy(input, user.guest_policy); else delete user.guest_policy;
  if (input.disabled !== undefined) user.disabled = Boolean(input.disabled);
  if (!state.users.some((item) => item.role === "admin" && !item.disabled)) throw new Error("Deve rimanere almeno un amministratore attivo.");
  if (user.id === actorId && user.disabled) throw new Error("Non puoi disabilitare il tuo account.");
  return user;
}

export function publicServer(server) {
  return { id: server.id, name: server.name, description: server.description, host: server.host, port: server.port, host_key: server.host_key, network_mode: server.network_mode || "direct", vpn_name: server.vpn_name || "" };
}

export function saveServer(state, input) {
  const current = input.id ? state.servers.find((item) => item.id === input.id) : null;
  if (input.id && !current) throw new Error("Server non trovato.");
  const host = text(input.host, "Host", 253);
  if (host.startsWith("-") || !/^[a-z0-9._:-]+$/i.test(host)) throw new Error("Host non valido.");
  const port = Number(input.port || 22);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Porta non valida.");
  const networkMode = input.network_mode === "vpn" ? "vpn" : input.network_mode === "direct" || input.network_mode === undefined ? "direct" : null;
  if (!networkMode) throw new Error("Tipo di rete non valido.");
  const server = {
    id: current?.id || newId(12), name: text(input.name, "Nome"),
    description: typeof input.description === "string" ? input.description.trim().slice(0, 500) : "",
    host, port, host_key: normalizeFingerprint(input.host_key), network_mode: networkMode,
    vpn_name: networkMode === "vpn" ? text(input.vpn_name, "Nome VPN", 80) : "",
  };
  if (current) state.servers[state.servers.indexOf(current)] = server; else state.servers.push(server);
  return server;
}

export function removeServer(state, id) {
  const index = state.servers.findIndex((item) => item.id === id);
  if (index < 0) throw new Error("Server non trovato.");
  const identityIds = new Set(state.identities.filter((item) => item.server_id === id).map((item) => item.id));
  state.servers.splice(index, 1);
  state.identities = state.identities.filter((item) => item.server_id !== id);
  state.accesses = state.accesses.filter((item) => !identityIds.has(item.identity_id));
}

export function publicIdentity(identity) {
  return { id: identity.id, server_id: identity.server_id, name: identity.name, username: identity.username, auth_type: identity.auth_type, has_secret: Boolean(identity.password || identity.private_key) };
}

export function saveIdentity(state, input) {
  const current = input.id ? state.identities.find((item) => item.id === input.id) : null;
  if (input.id && !current) throw new Error("Identità SSH non trovata.");
  if (!state.servers.some((server) => server.id === input.server_id)) throw new Error("Server non trovato.");
  const authType = ["password", "private_key"].includes(input.auth_type) ? input.auth_type : null;
  if (!authType) throw new Error("Tipo di credenziale non valido.");
  const secretField = authType === "password" ? "password" : "private_key";
  const secret = typeof input.secret === "string" && input.secret.length ? input.secret : current?.[secretField];
  if (!secret || secret.length > 128_000) throw new Error("Credenziale SSH assente o troppo lunga.");
  const identity = {
    id: current?.id || newId(12), server_id: input.server_id, name: text(input.name, "Nome identità"),
    username: text(input.username, "Utente SSH", 128), auth_type: authType, [secretField]: secret,
    ...(authType === "private_key" && (input.passphrase || current?.passphrase) ? { passphrase: String(input.passphrase || current.passphrase).slice(0, 500) } : {}),
  };
  if (current) state.identities[state.identities.indexOf(current)] = identity; else state.identities.push(identity);
  return identity;
}

export function removeIdentity(state, id) {
  const index = state.identities.findIndex((item) => item.id === id);
  if (index < 0) throw new Error("Identità SSH non trovata.");
  state.identities.splice(index, 1);
  state.accesses = state.accesses.filter((item) => item.identity_id !== id);
}

export function publicAccess(access) {
  return { id: access.id, user_id: access.user_id, identity_id: access.identity_id };
}

export function saveAccess(state, input) {
  const current = input.id ? state.accesses.find((item) => item.id === input.id) : null;
  if (input.id && !current) throw new Error("Accesso non trovato.");
  const user = state.users.find((item) => item.id === input.user_id && !item.disabled);
  const identity = state.identities.find((item) => item.id === input.identity_id);
  if (!user) throw new Error("Utente non disponibile.");
  if (!identity) throw new Error("Identità SSH non trovata.");
  if (state.accesses.some((item) => item.id !== current?.id && item.user_id === user.id && item.identity_id === identity.id)) throw new Error("Questo accesso è già assegnato.");
  const access = { id: current?.id || newId(12), user_id: user.id, identity_id: identity.id };
  if (current) state.accesses[state.accesses.indexOf(current)] = access; else state.accesses.push(access);
  return access;
}

export function removeAccess(state, id) {
  const index = state.accesses.findIndex((item) => item.id === id);
  if (index < 0) throw new Error("Accesso non trovato.");
  state.accesses.splice(index, 1);
}

export function resolveAccess(state, id) {
  const access = state.accesses.find((item) => item.id === id);
  const user = access && state.users.find((item) => item.id === access.user_id && !item.disabled);
  const identity = access && state.identities.find((item) => item.id === access.identity_id);
  const server = identity && state.servers.find((item) => item.id === identity.server_id);
  if (!access || !user || !identity || !server) throw new Error("Accesso non disponibile.");
  return { access, user, connection: { ...server, ...identity, id: access.id } };
}
