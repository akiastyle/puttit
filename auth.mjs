// auth.mjs v1.8.53
import { createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export async function passwordRecord(password) {
  if (typeof password !== "string" || password.length < 12 || password.length > 200) throw new Error("La password deve contenere almeno 12 caratteri.");
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
  return { password_salt: salt.toString("base64"), password_hash: hash.toString("base64") };
}

export async function passwordMatches(user, password) {
  try {
    const expected = Buffer.from(user.password_hash, "base64");
    const actual = await scrypt(String(password || ""), Buffer.from(user.password_salt, "base64"), expected.length, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch { return false; }
}

export function totpSecret() {
  const bytes = randomBytes(20);
  let bits = "";
  for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");
  return bits.match(/.{1,5}/g).map((part) => alphabet[parseInt(part.padEnd(5, "0"), 2)]).join("");
}

function decodeBase32(value) {
  let bits = "";
  for (const char of value.replace(/=+$/, "")) bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  return Buffer.from((bits.match(/.{8}/g) || []).map((byte) => parseInt(byte, 2)));
}

export function totp(secret, timestamp = Date.now()) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(Math.floor(timestamp / 30_000)));
  const digest = createHmac("sha1", decodeBase32(secret)).update(message).digest();
  const offset = digest.at(-1) & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

export function verifyTotp(secret, code) {
  return /^\d{6}$/.test(String(code)) && [-1, 0, 1].some((window) => {
    const expected = Buffer.from(totp(secret, Date.now() + window * 30_000));
    const actual = Buffer.from(String(code));
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  });
}

export function newId(bytes = 18) { return randomBytes(bytes).toString("base64url"); }
export function hashToken(token) { return createHash("sha256").update(token).digest("base64"); }
