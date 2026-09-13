// state.mjs v1.5.43
import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { dataDirectory, open, seal } from "./vault.mjs";

export const stateFile = () => join(dataDirectory(), "state.enc");
let writes = Promise.resolve();

export function emptyState() {
  return { version: 2, users: [], servers: [], identities: [], accesses: [] };
}

export async function loadState() {
  try {
    const state = await open(await readFile(stateFile(), "utf8"));
    if (state.version !== 2) throw new Error("I dati appartengono alla base precedente e devono essere rimossi prima del nuovo avvio.");
    return { ...emptyState(), ...state };
  }
  catch (error) { if (error.code === "ENOENT") return emptyState(); throw error; }
}

async function saveState(state) {
  const path = stateFile();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(temporary, await seal(state), { mode: 0o600, flush: true });
  await chmod(temporary, 0o600).catch(() => {});
  await rename(temporary, path);
}

export async function updateState(change) {
  const previous = writes;
  let release;
  writes = new Promise((resolve) => { release = resolve; });
  await previous;
  try {
    const state = await loadState();
    const result = await change(state);
    await saveState(state);
    return result;
  } finally { release(); }
}
