// ssh.mjs v0.1.0
import { EventEmitter } from "node:events";
import { timingSafeEqual } from "node:crypto";
import { createConnection } from "node:net";
import ssh2 from "ssh2";

const { Client } = ssh2;

const fingerprintPattern = /^SHA256:([A-Za-z0-9+/]{43})=?$/;

function fingerprint(hash) {
  return `SHA256:${Buffer.from(hash, "hex").toString("base64").replace(/=+$/, "")}`;
}

export function normalizeFingerprint(value) {
  const match = fingerprintPattern.exec(String(value || "").trim());
  if (!match) throw new Error("Fingerprint SSH non valida.");
  return `SHA256:${match[1]}`;
}

function sameFingerprint(expected, actual) {
  const left = Buffer.from(normalizeFingerprint(expected));
  const right = Buffer.from(normalizeFingerprint(actual));
  return left.length === right.length && timingSafeEqual(left, right);
}

function address(connection) {
  const host = String(connection.host || "").trim();
  const port = Number(connection.port || 22);
  if (!host || host.startsWith("-") || host.length > 253 || !/^[a-z0-9._:-]+$/i.test(host)) throw new Error("Host SSH non valido.");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Porta SSH non valida.");
  return { host, port };
}

export function serverReachable(connection, timeout = 2_500) {
  const target = address(connection);
  return new Promise((resolve) => {
    const socket = createConnection(target);
    const finish = (available) => { socket.destroy(); resolve(available); };
    socket.setTimeout(timeout, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

export function scanHostKey(connection, timeout = 10_000) {
  const target = address(connection);
  return new Promise((resolve, reject) => {
    const client = new Client();
    let found;
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.end();
      if (found) resolve(found); else reject(error || new Error("Il server SSH non ha restituito una fingerprint."));
    };
    const timer = setTimeout(() => finish(new Error("Il server SSH non ha risposto.")), timeout);
    client.on("error", finish);
    client.on("close", () => finish());
    client.connect({
      ...target,
      username: "puttit-scan",
      readyTimeout: timeout,
      hostHash: "sha256",
      hostVerifier(hash) {
        found = fingerprint(hash);
        return false;
      },
    });
  });
}

export class SshSession extends EventEmitter {
  #client;
  #stream;

  constructor(client, stream) {
    super();
    this.#client = client;
    this.#stream = stream;
    stream.on("data", (data) => this.emit("data", data));
    stream.stderr.on("data", (data) => this.emit("data", data));
    stream.on("close", (code, signal) => {
      client.end();
      this.emit("close", { code, signal });
    });
    client.on("error", (error) => this.emit("error", error));
  }

  write(data) {
    if (this.#stream.writable) this.#stream.write(data);
  }

  resize(cols, rows) {
    if (Number.isInteger(cols) && cols >= 2 && cols <= 1000 && Number.isInteger(rows) && rows >= 1 && rows <= 500)
      this.#stream.setWindow(rows, cols, 0, 0);
  }

  close() {
    this.#stream.end();
    this.#client.end();
  }
}

export function openSshSession(connection, terminal = {}) {
  const target = address(connection);
  const expected = normalizeFingerprint(connection.host_key);
  const username = String(connection.username || "").trim();
  if (!username || username.length > 128) throw new Error("Utente SSH non valido.");
  if (!connection.password && !connection.private_key) throw new Error("Credenziale SSH assente.");

  return new Promise((resolve, reject) => {
    const client = new Client();
    let settled = false;
    const fail = (error) => {
      if (!settled) { settled = true; client.end(); reject(error); }
    };
    client.once("error", fail);
    client.once("ready", () => {
      client.shell({
        term: "xterm-256color",
        cols: Number(terminal.cols) || 80,
        rows: Number(terminal.rows) || 24,
      }, (error, stream) => {
        if (error) return fail(error);
        settled = true;
        client.removeListener("error", fail);
        resolve(new SshSession(client, stream));
      });
    });
    client.connect({
      ...target,
      username,
      ...(connection.password ? { password: connection.password } : { privateKey: connection.private_key, passphrase: connection.passphrase || undefined }),
      readyTimeout: 15_000,
      keepaliveInterval: 30_000,
      keepaliveCountMax: 3,
      hostHash: "sha256",
      hostVerifier: (hash) => sameFingerprint(expected, fingerprint(hash)),
    });
  });
}
