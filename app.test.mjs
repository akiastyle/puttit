// app.test.mjs v0.1.0
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveAccess } from "./admin.mjs";
import { createApp } from "./app.mjs";
import { totp } from "./auth.mjs";
import { loadState, stateFile } from "./state.mjs";

test("l'admin separa server, identità SSH e accessi senza esporre credenziali", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "puttit-admin-"));
  process.env.PUTTIT_DATA_DIR = directory;
  process.env.PUTTIT_MASTER_KEY = randomBytes(32).toString("base64");
  context.after(() => rm(directory, { recursive: true, force: true }));

  const server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  context.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  let cookie = "";
  const post = async (path, body = {}) => {
    const response = await fetch(`${origin}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
    if (response.headers.get("set-cookie")) cookie = response.headers.get("set-cookie").split(";")[0];
    return { status: response.status, body: await response.json() };
  };

  const setup = await post("/auth/configura", { name: "Ada Admin", username: "ada", password: "password-lunga" });
  assert.equal(setup.status, 200);
  assert.equal((await post("/auth/conferma", { token: setup.body.token, code: totp(setup.body.secret) })).status, 200);
  assert.equal((await post("/auth/accedi", { username: "ada", password: "password-lunga", code: totp(setup.body.secret) })).status, 200);

  const created = await post("/admin/utenti/crea", { name: "Mario Rossi", username: "mario", password: "altra-password", role: "user" });
  assert.equal(created.status, 200);
  assert.equal(created.body.user.password_hash, undefined);
  assert.match(created.body.secret, /^[A-Z2-7]+$/);

  const guest = await post("/admin/utenti/crea", { name: "Ospite", username: "ospite", password: "guest-password", role: "guest", guest_mode: "duration", guest_minutes: 600 });
  assert.deepEqual(guest.body.user.guest_policy, { mode: "duration", minutes: 600 });
  assert.equal((await post("/admin/utenti/aggiorna", { id: guest.body.user.id, guest_mode: "duration", guest_minutes: 601 })).status, 400);
  assert.equal((await post("/admin/utenti/aggiorna", { id: guest.body.user.id, guest_mode: "approval" })).body.user.guest_policy.mode, "approval");

  const hostKey = `SHA256:${Buffer.alloc(32, 7).toString("base64").replace(/=+$/, "")}`;
  const serverResult = await post("/admin/server/salva", {
    name: "Produzione", description: "Gestionale", host: "server.lan", port: 22, host_key: hostKey,
    network_mode: "vpn", vpn_name: "VPN sede centrale",
  });
  assert.equal(serverResult.status, 200);
  const identityResult = await post("/admin/identita/salva", {
    server_id: serverResult.body.server.id, name: "Deploy", username: "deploy", auth_type: "password", secret: "ssh-segreta",
  });
  assert.equal(identityResult.status, 200);
  assert.equal(identityResult.body.identity.password, undefined);
  const accessResult = await post("/admin/accessi/salva", { user_id: created.body.user.id, identity_id: identityResult.body.identity.id });
  assert.equal(accessResult.status, 200);
  assert.equal((await post("/admin/accessi/salva", { user_id: created.body.user.id, identity_id: identityResult.body.identity.id })).status, 400);

  const panel = await post("/admin/pannello");
  assert.equal(panel.status, 200);
  assert.equal((await post("/admin/utenti/aggiorna", { id: panel.body.admin.id, disabled: true })).status, 400);
  assert.equal(panel.body.servers.length, 1);
  assert.equal(panel.body.servers[0].vpn_name, "VPN sede centrale");
  assert.equal(panel.body.identities[0].has_secret, true);
  assert.deepEqual(panel.body.accesses[0], accessResult.body.access);
  const adminAccess = await post("/admin/accessi/salva", { user_id: panel.body.admin.id, identity_id: identityResult.body.identity.id });
  assert.equal(adminAccess.status, 200);
  assert.equal(JSON.stringify(panel.body).includes("ssh-segreta"), false);
  assert.equal((await readFile(stateFile(), "utf8")).includes("ssh-segreta"), false);
  const stored = await loadState();
  assert.equal(stored.identities[0].password, "ssh-segreta");
  const resolved = resolveAccess(stored, accessResult.body.access.id);
  assert.equal(resolved.connection.host, "server.lan");
  assert.equal(resolved.connection.username, "deploy");
  assert.equal(resolved.connection.password, "ssh-segreta");
  assert.equal(resolveAccess(stored, adminAccess.body.access.id).user.role, "admin");
});
