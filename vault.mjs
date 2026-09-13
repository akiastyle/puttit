// vault.mjs v0.1.0
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
let cachedKey;

export function dataDirectory() {
  if (process.env.PUTTIT_DATA_DIR) return process.env.PUTTIT_DATA_DIR;
  if (process.platform === "win32") return join(process.env.APPDATA || homedir(), "Puttit");
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "Puttit");
  return join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "puttit");
}

function isWsl() {
  return Boolean(process.env.WSL_DISTRO_NAME) || existsSync("/proc/sys/fs/binfmt_misc/WSLInterop");
}

function validKey(encoded) {
  const key = Buffer.from(String(encoded || "").trim(), "base64");
  if (key.length !== 32) throw new Error("La chiave principale di Puttit non è valida.");
  return key;
}

async function windowsKey() {
  const blobFile = join(dataDirectory(), "master.dpapi");
  const powershell = process.env.PUTTIT_POWERSHELL || process.env.PUTTY_MCP_POWERSHELL || "powershell.exe";
  if (existsSync(blobFile)) {
    const blob = (await readFile(blobFile, "utf8")).trim();
    const script = "Add-Type -AssemblyName System.Security;$b=[Convert]::FromBase64String([Console]::In.ReadToEnd());$k=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Convert]::ToBase64String($k)";
    return validKey(await pipeSecret(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], blob));
  }
  const script = "Add-Type -AssemblyName System.Security;$k=New-Object byte[] 32;[Security.Cryptography.RNGCryptoServiceProvider]::Create().GetBytes($k);$b=[Security.Cryptography.ProtectedData]::Protect($k,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[PSCustomObject]@{key=[Convert]::ToBase64String($k);blob=[Convert]::ToBase64String($b)}|ConvertTo-Json -Compress";
  const { stdout } = await execFile(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
  const created = JSON.parse(stdout);
  await mkdir(dirname(blobFile), { recursive: true, mode: 0o700 });
  await writeFile(blobFile, created.blob, { mode: 0o600, flag: "wx" });
  await chmod(blobFile, 0o600).catch(() => {});
  return validKey(created.key);
}

function pipeSecret(command, args, secret) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr.trim() || `${command} non disponibile.`)));
    child.stdin.end(secret);
  });
}

async function linuxKey() {
  try {
    const { stdout } = await execFile("secret-tool", ["lookup", "application", "puttit", "account", process.env.USER || "default"], { encoding: "utf8", timeout: 10_000 });
    if (stdout.trim()) return validKey(stdout);
  } catch (cause) {
    if (cause.code !== 1) throw new Error("Il portachiavi Secret Service non è disponibile. Installa libsecret-tools oppure imposta PUTTIT_MASTER_KEY.");
  }
  const encoded = randomBytes(32).toString("base64");
  await pipeSecret("secret-tool", ["store", "--label=Puttit", "application", "puttit", "account", process.env.USER || "default"], encoded);
  return validKey(encoded);
}

async function macKey() {
  const account = process.env.USER || "default";
  try {
    const { stdout } = await execFile("security", ["find-generic-password", "-a", account, "-s", "Puttit", "-w"], { encoding: "utf8", timeout: 10_000 });
    return validKey(stdout);
  } catch (cause) {
    if (cause.code !== 44) throw cause;
  }
  const encoded = randomBytes(32).toString("base64");
  await execFile("security", ["add-generic-password", "-U", "-a", account, "-s", "Puttit", "-w", encoded], { windowsHide: true, timeout: 10_000 });
  return validKey(encoded);
}

export async function masterKey() {
  if (cachedKey) return cachedKey;
  if (process.env.PUTTIT_MASTER_KEY) cachedKey = validKey(process.env.PUTTIT_MASTER_KEY);
  else if (process.env.PUTTIT_MASTER_KEY_FILE) {
    const info = await stat(process.env.PUTTIT_MASTER_KEY_FILE);
    if (!info.isFile() || process.platform !== "win32" && (info.mode & 0o007)) throw new Error("Il file della chiave principale è accessibile ad altri utenti.");
    cachedKey = validKey(await readFile(process.env.PUTTIT_MASTER_KEY_FILE, "utf8"));
  }
  else if (process.platform === "win32" || isWsl()) cachedKey = await windowsKey();
  else if (process.platform === "darwin") cachedKey = await macKey();
  else cachedKey = await linuxKey();
  return cachedKey;
}

export async function seal(value) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", await masterKey(), nonce);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return JSON.stringify({ version: 1, nonce: nonce.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") });
}

export async function open(sealed) {
  const payload = JSON.parse(sealed);
  if (payload.version !== 1) throw new Error("Formato archivio Puttit non supportato.");
  const decipher = createDecipheriv("aes-256-gcm", await masterKey(), Buffer.from(payload.nonce, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, "base64")), decipher.final()]).toString("utf8"));
}
