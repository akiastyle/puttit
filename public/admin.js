// admin.js v1.33.243
const root = document.querySelector("#main");
const state = { admin: null, users: [], servers: [], identities: [], accesses: [], page: "accesses" };
let monitorTimer;

const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

async function request(path, data = {}) {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Operazione non riuscita.");
  return result;
}

function announce(message) {
  document.querySelector("#announcer").textContent = message;
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.append(toast);
  setTimeout(() => toast.remove(), 2400);
}

function error(form, message) {
  let box = form.querySelector(".error");
  if (!box) { box = document.createElement("div"); box.className = "error"; box.setAttribute("role", "alert"); form.prepend(box); }
  box.textContent = message;
}

function auth(title, copy, fields) {
  root.innerHTML = `<section class="auth-shell"><div class="auth-panel"><div class="brand"><span class="brand-mark">P</span>Puttit</div><div class="auth-copy"><h1>${title}</h1><p>${copy}</p></div>${fields}</div><div class="auth-art" aria-hidden="true"></div></section>`;
}

function setup() {
  auth("Crea l’amministratore", "Questo account gestirà utenti, collegamenti e autorizzazioni.", `
    <form class="stack" id="setup">
      <div class="field"><label for="name">Nome</label><input id="name" name="name" autocomplete="name" required></div>
      <div class="field"><label for="username">Nome utente</label><input id="username" name="username" autocomplete="username" minlength="3" required></div>
      <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="new-password" minlength="12" required></div>
      <button class="button primary">Continua con la verifica 2FA</button>
    </form>`);
  document.querySelector("#setup").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const data = Object.fromEntries(new FormData(event.currentTarget));
      const result = await request("/auth/configura", data);
      confirmSetup(result);
    } catch (cause) { error(event.currentTarget, cause.message); }
  });
}

function confirmSetup(pending) {
  auth("Attiva la verifica 2FA", "Aggiungi questa chiave nell’app di autenticazione, poi inserisci il codice generato.", `
    <form class="stack" id="confirm-setup">
      <div class="secret"><small class="muted">Chiave TOTP</small><div class="mono setup-secret">${escapeHtml(pending.secret)}</div></div>
      <div class="field"><label for="code">Codice a 6 cifre</label><input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" required></div>
      <button class="button primary">Completa configurazione</button>
    </form>`);
  document.querySelector("#confirm-setup").addEventListener("submit", async (event) => {
    event.preventDefault();
    try { await request("/auth/conferma", { token: pending.token, code: new FormData(event.currentTarget).get("code") }); login(); }
    catch (cause) { error(event.currentTarget, cause.message); }
  });
}

function login() {
  auth("Amministrazione", "Accedi per gestire gli utenti e i collegamenti disponibili.", `
    <form class="stack" id="login">
      <div class="field"><label for="username">Nome utente</label><input id="username" name="username" autocomplete="username" required></div>
      <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required></div>
      <div class="field"><label for="code">Codice 2FA</label><input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" required></div>
      <button class="button primary">Accedi</button>
    </form>`);
  document.querySelector("#login").addEventListener("submit", async (event) => {
    event.preventDefault();
    try { await request("/auth/accedi", Object.fromEntries(new FormData(event.currentTarget))); await load(); }
    catch (cause) { error(event.currentTarget, cause.message); }
  });
}

async function load() {
  try { Object.assign(state, await request("/admin/pannello")); shell(); render(); }
  catch { login(); }
}

function shell() {
  root.innerHTML = `<div class="app-shell">
    <header class="topbar"><div class="brand"><span class="brand-mark">P</span>Puttit</div><div></div><div class="account"><div class="account-copy"><strong>${escapeHtml(state.admin.name)}</strong><small>Amministratore</small></div><button class="button quiet" id="logout">Esci</button></div></header>
    <nav class="sidebar" aria-label="Amministrazione">
      <button class="nav-button" data-page="monitor">Controllo</button>
      <button class="nav-button" data-page="accesses">Accessi</button>
      <button class="nav-button" data-page="servers">Server</button>
      <button class="nav-button" data-page="identities">Identità SSH</button>
      <button class="nav-button" data-page="users">Utenti</button>
    </nav>
    <section class="workspace" id="workspace"></section>
  </div>`;
  document.querySelectorAll("[data-page]").forEach((button) => button.addEventListener("click", () => { state.page = button.dataset.page; render(); }));
  document.querySelector("#logout").addEventListener("click", async () => { await request("/auth/esci"); login(); });
}

function render() {
  clearTimeout(monitorTimer);
  document.querySelectorAll("[data-page]").forEach((button) => button.classList.toggle("active", button.dataset.page === state.page));
  ({ monitor: monitorPage, accesses: accessesPage, servers: serversPage, identities: identitiesPage, users: usersPage }[state.page] || accessesPage)();
}

const byId = (items, id) => items.find((item) => item.id === id);
const serverForIdentity = (identity) => byId(state.servers, identity?.server_id);

async function monitorPage() {
  clearTimeout(monitorTimer);
  const workspace = document.querySelector("#workspace");
  try {
    const monitor = await request("/admin/monitoraggio");
    const requests = monitor.requests.map((item) => `<tr><td><strong>${escapeHtml(item.user_name)}</strong></td><td>${escapeHtml(item.server_name)}</td><td>${new Date(item.requested_at).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}</td><td class="actions"><button class="button approve-request" data-id="${item.id}">Approva</button><button class="button quiet reject-request" data-id="${item.id}">Rifiuta</button></td></tr>`).join("");
    const sessions = monitor.sessions.map((item) => `<tr><td><strong>${escapeHtml(item.user_name)}</strong></td><td>${escapeHtml(item.server_name)}</td><td>${new Date(item.started_at).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}</td><td><span class="status available">${item.status === "active" ? "Attiva" : "In chiusura"}</span></td><td><button class="button danger close-session" data-id="${item.id}"${item.status !== "active" ? " disabled" : ""}>Chiudi</button></td></tr>`).join("");
    workspace.innerHTML = `<div class="page"><header class="page-header"><div><h1>Controllo</h1><p>Richieste guest e sessioni SSH attive, senza contenuto del terminale.</p></div><button class="button" id="refresh-monitor">Aggiorna</button></header><h2 class="section-title">Richieste in attesa</h2>${requests ? `<div class="table-wrap"><table class="table"><thead><tr><th>Persona</th><th>Server</th><th>Ora</th><th></th></tr></thead><tbody>${requests}</tbody></table></div>` : `<div class="empty compact"><strong>Nessuna richiesta</strong></div>`}<h2 class="section-title">Sessioni attive</h2>${sessions ? `<div class="table-wrap"><table class="table"><thead><tr><th>Persona</th><th>Server</th><th>Avviata</th><th>Stato</th><th></th></tr></thead><tbody>${sessions}</tbody></table></div>` : `<div class="empty compact"><strong>Nessuna sessione attiva</strong></div>`}</div>`;
    document.querySelector("#refresh-monitor").addEventListener("click", monitorPage);
    document.querySelectorAll(".approve-request").forEach((button) => button.addEventListener("click", () => decideRequest(button.dataset.id, true)));
    document.querySelectorAll(".reject-request").forEach((button) => button.addEventListener("click", () => decideRequest(button.dataset.id, false)));
    document.querySelectorAll(".close-session").forEach((button) => button.addEventListener("click", async () => { try { await request("/admin/sessioni/chiudi", { id: button.dataset.id }); await monitorPage(); announce("Sessione chiusa"); } catch (cause) { announce(cause.message); } }));
  } catch (cause) { workspace.innerHTML = `<div class="page"><div class="error">${escapeHtml(cause.message)}</div></div>`; }
  if (state.page === "monitor") monitorTimer = setTimeout(monitorPage, 5_000);
}

async function decideRequest(id, approved) {
  try { await request("/admin/richieste/decidi", { id, approved }); await monitorPage(); announce(approved ? "Accesso approvato" : "Accesso rifiutato"); }
  catch (cause) { announce(cause.message); }
}

function accessesPage() {
  const rows = state.accesses.map((access) => {
    const user = byId(state.users, access.user_id);
    const identity = byId(state.identities, access.identity_id);
    const server = serverForIdentity(identity);
    return `<tr><td><strong>${escapeHtml(user?.name || "Utente rimosso")}</strong><small class="table-subtitle">${escapeHtml(user?.username || "")}</small></td><td><strong>${escapeHtml(server?.name || "Server rimosso")}</strong><small class="table-subtitle mono">${escapeHtml(server?.host || "")}</small></td><td>${escapeHtml(identity?.name || "Identità rimossa")}<small class="table-subtitle">${escapeHtml(identity?.username || "")}</small></td><td>${user?.role === "guest" ? (user.guest_policy.mode === "approval" ? "Approvazione manuale" : formatDuration(user.guest_policy.minutes)) : "Diretto"}</td><td><button class="button quiet remove-access" data-id="${access.id}">Revoca</button></td></tr>`;
  }).join("");
  document.querySelector("#workspace").innerHTML = `<div class="page"><header class="page-header"><div><h1>Accessi</h1><p>Chi entra, in quale server e con quale identità SSH.</p></div><button class="button primary" id="new-access"${!state.users.length || !state.identities.length ? " disabled" : ""}>Assegna accesso</button></header>${rows ? `<div class="table-wrap"><table class="table"><thead><tr><th>Persona</th><th>Server</th><th>Identità SSH</th><th>Controllo</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="empty"><strong>Nessun accesso assegnato</strong>Crea un server e un’identità SSH, poi scegli chi può usarli.</div>`}</div>`;
  document.querySelector("#new-access").addEventListener("click", accessForm);
  document.querySelectorAll(".remove-access").forEach((button) => button.addEventListener("click", async () => { if (confirm("Revocare questo accesso?")) { await request("/admin/accessi/elimina", { id: button.dataset.id }); await reload("Accesso revocato"); } }));
}

function accessForm() {
  const users = state.users.filter((user) => !user.disabled);
  drawer("Assegna accesso", `<form class="stack" id="access-form"><div class="field"><label for="access-user">Persona</label><select id="access-user" name="user_id">${users.map((user) => `<option value="${user.id}">${escapeHtml(user.name)} · ${user.role === "guest" ? "Ospite" : user.role === "admin" ? "Amministratore" : "Utente"}</option>`).join("")}</select></div><div class="field"><label for="access-identity">Server e identità SSH</label><select id="access-identity" name="identity_id">${state.identities.map((identity) => `<option value="${identity.id}">${escapeHtml(serverForIdentity(identity)?.name)} · ${escapeHtml(identity.name)} (${escapeHtml(identity.username)})</option>`).join("")}</select></div><div class="form-actions"><span></span><span></span><button class="button" type="button" data-close>Annulla</button><button class="button primary">Assegna</button></div></form>`);
  const form = document.querySelector("#access-form");
  form.addEventListener("submit", async (event) => { event.preventDefault(); try { await request("/admin/accessi/salva", Object.fromEntries(new FormData(form))); closeDrawer(); await reload("Accesso assegnato"); } catch (cause) { error(form, cause.message); } });
}

function serversPage() {
  const rows = state.servers.map((server) => `<tr><td><strong>${escapeHtml(server.name)}</strong><small class="table-subtitle">${escapeHtml(server.description || "Nessuna descrizione")}</small></td><td class="mono">${escapeHtml(server.host)}:${server.port}</td><td>${server.network_mode === "vpn" ? `VPN · ${escapeHtml(server.vpn_name)}` : "Diretta"}</td><td><button class="button check-server" data-id="${server.id}">Verifica</button></td><td><button class="button quiet edit-server" data-id="${server.id}">Modifica</button></td></tr>`).join("");
  document.querySelector("#workspace").innerHTML = `<div class="page"><header class="page-header"><div><h1>Server</h1><p>Destinazioni SSH, percorso di rete e identità verificata.</p></div><button class="button primary" id="new-server">Nuovo server</button></header>${rows ? `<div class="table-wrap"><table class="table"><thead><tr><th>Server</th><th>Destinazione</th><th>Rete</th><th>Stato</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="empty"><strong>Nessun server</strong>Aggiungi la prima destinazione SSH.</div>`}</div>`;
  document.querySelector("#new-server").addEventListener("click", () => serverForm());
  document.querySelectorAll(".check-server").forEach((button) => button.addEventListener("click", async () => { button.disabled = true; button.textContent = "Verifica…"; try { const result = await request("/admin/server/verifica", { id: button.dataset.id }); button.textContent = result.available ? "Raggiungibile" : "Non raggiungibile"; button.classList.toggle("reachable", result.available); } catch { button.textContent = "Non verificato"; } finally { button.disabled = false; } }));
  document.querySelectorAll(".edit-server").forEach((button) => button.addEventListener("click", () => serverForm(byId(state.servers, button.dataset.id))));
}

function serverForm(server = {}) {
  drawer(server.id ? "Modifica server" : "Nuovo server", `<form class="stack" id="server-form"><input type="hidden" name="id" value="${escapeHtml(server.id || "")}"><div class="form-grid"><div class="field"><label for="server-name">Nome</label><input id="server-name" name="name" value="${escapeHtml(server.name || "")}" required></div><div class="field"><label for="server-host">Host</label><input id="server-host" name="host" value="${escapeHtml(server.host || "")}" required></div><div class="field"><label for="server-port">Porta</label><input id="server-port" name="port" type="number" min="1" max="65535" value="${server.port || 22}" required></div><div class="field"><label for="network-mode">Percorso di rete</label><select id="network-mode" name="network_mode"><option value="direct"${server.network_mode !== "vpn" ? " selected" : ""}>Diretto</option><option value="vpn"${server.network_mode === "vpn" ? " selected" : ""}>VPN già attiva sul server Puttit</option></select></div><div class="field wide vpn-name"><label for="vpn-name">Nome VPN</label><input id="vpn-name" name="vpn_name" value="${escapeHtml(server.vpn_name || "")}" placeholder="VPN sede centrale"></div><div class="field wide"><label for="server-description">Descrizione</label><input id="server-description" name="description" value="${escapeHtml(server.description || "")}"></div><div class="field wide"><label for="host-key">Fingerprint server</label><div class="input-action"><input class="mono" id="host-key" name="host_key" value="${escapeHtml(server.host_key || "")}" required><button class="button" type="button" id="scan">Rileva</button></div><small class="muted">Confrontala con quella comunicata dall’amministratore del server.</small></div></div><div class="form-actions">${server.id ? `<button class="button danger" type="button" id="delete-server">Elimina</button>` : ""}<span></span><button class="button" type="button" data-close>Annulla</button><button class="button primary">Salva</button></div></form>`);
  const form = document.querySelector("#server-form");
  const updateNetwork = () => { form.querySelector(".vpn-name").hidden = form.elements.network_mode.value !== "vpn"; form.elements.vpn_name.required = form.elements.network_mode.value === "vpn"; };
  form.elements.network_mode.addEventListener("change", updateNetwork);
  updateNetwork();
  document.querySelector("#scan").addEventListener("click", async () => { try { form.elements.host_key.value = (await request("/admin/server/scansiona", { host: form.elements.host.value, port: form.elements.port.value })).fingerprint; announce("Fingerprint rilevata"); } catch (cause) { error(form, cause.message); } });
  form.addEventListener("submit", async (event) => { event.preventDefault(); try { await request("/admin/server/salva", Object.fromEntries(new FormData(form))); closeDrawer(); await reload("Server salvato"); } catch (cause) { error(form, cause.message); } });
  document.querySelector("#delete-server")?.addEventListener("click", async () => { if (confirm("Eliminare il server, le sue identità e gli accessi associati?")) { await request("/admin/server/elimina", { id: server.id }); closeDrawer(); await reload("Server eliminato"); } });
}

function identitiesPage() {
  const rows = state.identities.map((identity) => `<tr><td><strong>${escapeHtml(identity.name)}</strong><small class="table-subtitle">${escapeHtml(identity.username)}</small></td><td>${escapeHtml(serverForIdentity(identity)?.name || "Server rimosso")}</td><td>${identity.auth_type === "password" ? "Password" : "Chiave privata"}</td><td><span class="status available">Configurata</span></td><td><button class="button quiet edit-identity" data-id="${identity.id}">Modifica</button></td></tr>`).join("");
  document.querySelector("#workspace").innerHTML = `<div class="page"><header class="page-header"><div><h1>Identità SSH</h1><p>Account remoti e credenziali custodite da Puttit.</p></div><button class="button primary" id="new-identity"${!state.servers.length ? " disabled" : ""}>Nuova identità</button></header>${rows ? `<div class="table-wrap"><table class="table"><thead><tr><th>Identità</th><th>Server</th><th>Metodo</th><th>Credenziale</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="empty"><strong>Nessuna identità SSH</strong>Crea prima un server, poi aggiungi l’account remoto.</div>`}</div>`;
  document.querySelector("#new-identity").addEventListener("click", () => identityForm());
  document.querySelectorAll(".edit-identity").forEach((button) => button.addEventListener("click", () => identityForm(byId(state.identities, button.dataset.id))));
}

function identityForm(identity = {}) {
  drawer(identity.id ? "Modifica identità SSH" : "Nuova identità SSH", `<form class="stack" id="identity-form"><input type="hidden" name="id" value="${escapeHtml(identity.id || "")}"><div class="field"><label for="identity-server">Server</label><select id="identity-server" name="server_id">${state.servers.map((server) => `<option value="${server.id}"${server.id === identity.server_id ? " selected" : ""}>${escapeHtml(server.name)}</option>`).join("")}</select></div><div class="field"><label for="identity-name">Nome identità</label><input id="identity-name" name="name" value="${escapeHtml(identity.name || "")}" placeholder="Amministrazione" required></div><div class="field"><label for="ssh-user">Utente SSH</label><input id="ssh-user" name="username" value="${escapeHtml(identity.username || "")}" required></div><div class="field"><label for="auth-type">Metodo</label><select id="auth-type" name="auth_type"><option value="password"${identity.auth_type === "password" ? " selected" : ""}>Password</option><option value="private_key"${identity.auth_type === "private_key" ? " selected" : ""}>Chiave privata</option></select></div><div class="field"><label for="secret">${identity.has_secret ? "Nuova credenziale (facoltativa)" : "Credenziale"}</label><textarea id="secret" name="secret"${identity.has_secret ? "" : " required"}></textarea></div><div class="field"><label for="passphrase">Passphrase della chiave (facoltativa)</label><input id="passphrase" name="passphrase" type="password" autocomplete="off"></div><div class="form-actions">${identity.id ? `<button class="button danger" type="button" id="delete-identity">Elimina</button>` : ""}<span></span><button class="button" type="button" data-close>Annulla</button><button class="button primary">Salva</button></div></form>`);
  const form = document.querySelector("#identity-form");
  form.addEventListener("submit", async (event) => { event.preventDefault(); try { await request("/admin/identita/salva", Object.fromEntries(new FormData(form))); closeDrawer(); await reload("Identità salvata"); } catch (cause) { error(form, cause.message); } });
  document.querySelector("#delete-identity")?.addEventListener("click", async () => { if (confirm("Eliminare l’identità e revocare gli accessi associati?")) { await request("/admin/identita/elimina", { id: identity.id }); closeDrawer(); await reload("Identità eliminata"); } });
}

function usersPage() {
  const rows = state.users.map((user) => `<tr><td><strong>${escapeHtml(user.name)}</strong><small class="table-subtitle">${escapeHtml(user.username)}</small></td><td><select class="role-select" data-id="${user.id}"${user.id === state.admin.id ? " disabled" : ""}><option value="admin"${user.role === "admin" ? " selected" : ""}>Amministratore</option><option value="user"${user.role === "user" ? " selected" : ""}>Utente</option><option value="guest"${user.role === "guest" ? " selected" : ""}>Ospite</option></select></td><td>${user.role === "guest" ? `<button class="button quiet guest-policy" data-id="${user.id}">${user.guest_policy.mode === "approval" ? "Approvazione ogni accesso" : formatDuration(user.guest_policy.minutes)}</button>` : `<span class="muted">Accesso assegnato</span>`}</td><td><button class="button user-status" data-id="${user.id}" data-disabled="${!user.disabled}"${user.id === state.admin.id ? " disabled" : ""}>${user.disabled ? "Riattiva" : "Disabilita"}</button></td></tr>`).join("");
  document.querySelector("#workspace").innerHTML = `<div class="page"><header class="page-header"><div><h1>Utenti</h1><p>Ruoli e regole di accesso degli ospiti.</p></div><button class="button primary" id="new-user">Nuovo utente</button></header><div class="table-wrap"><table class="table"><thead><tr><th>Persona</th><th>Ruolo</th><th>Controllo accesso</th><th>Stato</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  document.querySelector("#new-user").addEventListener("click", userForm);
  document.querySelectorAll(".role-select").forEach((select) => select.addEventListener("change", async () => { try { await request("/admin/utenti/aggiorna", { id: select.dataset.id, role: select.value }); await reload("Ruolo aggiornato"); } catch (cause) { announce(cause.message); await load(); } }));
  document.querySelectorAll(".user-status").forEach((button) => button.addEventListener("click", async () => { try { await request("/admin/utenti/aggiorna", { id: button.dataset.id, disabled: button.dataset.disabled === "true" }); await reload("Stato aggiornato"); } catch (cause) { announce(cause.message); } }));
  document.querySelectorAll(".guest-policy").forEach((button) => button.addEventListener("click", () => guestPolicyForm(state.users.find((user) => user.id === button.dataset.id))));
}

function formatDuration(minutes) {
  return minutes % 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m massimo` : `${minutes / 60}h massimo`;
}

function guestPolicyFields(policy = { mode: "approval", minutes: 60 }) {
  return `<fieldset class="stack guest-controls"><legend>Controllo del collegamento SSH</legend><label class="method-choice"><input type="radio" name="guest_mode" value="approval"${policy.mode === "approval" ? " checked" : ""}><span><strong>Approvazione manuale</strong><small>Ogni tentativo richiede una nuova autorizzazione dell’amministratore.</small></span></label><label class="method-choice"><input type="radio" name="guest_mode" value="duration"${policy.mode === "duration" ? " checked" : ""}><span><strong>Durata massima</strong><small>La sessione viene chiusa automaticamente al limite stabilito.</small></span></label><div class="field duration-field"><label for="guest-minutes">Durata in minuti, massimo 600</label><input id="guest-minutes" name="guest_minutes" type="number" min="1" max="600" value="${policy.minutes || 60}"></div></fieldset>`;
}

function bindGuestControls(form) {
  const update = () => { form.querySelector(".duration-field").hidden = form.elements.guest_mode.value !== "duration"; };
  form.querySelectorAll("[name=guest_mode]").forEach((input) => input.addEventListener("change", update));
  update();
}

function guestPolicyForm(user) {
  drawer(`Controllo di ${escapeHtml(user.name)}`, `<form class="stack" id="guest-policy-form">${guestPolicyFields(user.guest_policy)}<div class="form-actions"><span></span><span></span><button class="button" type="button" data-close>Annulla</button><button class="button primary">Salva</button></div></form>`);
  const form = document.querySelector("#guest-policy-form");
  bindGuestControls(form);
  form.addEventListener("submit", async (event) => { event.preventDefault(); try { await request("/admin/utenti/aggiorna", { id: user.id, ...Object.fromEntries(new FormData(form)) }); closeDrawer(); await reload("Controllo guest aggiornato"); } catch (cause) { error(form, cause.message); } });
}

function userForm() {
  drawer("Nuovo utente", `<form class="stack" id="user-form"><div class="field"><label for="user-name">Nome</label><input id="user-name" name="name" required></div><div class="field"><label for="user-login">Nome utente</label><input id="user-login" name="username" minlength="3" required></div><div class="field"><label for="user-role">Ruolo</label><select id="user-role" name="role"><option value="user">Utente</option><option value="guest">Ospite</option><option value="admin">Amministratore</option></select></div><div class="field"><label for="user-password">Password iniziale</label><input id="user-password" name="password" type="password" minlength="12" autocomplete="new-password" required></div><div id="new-guest-policy" hidden>${guestPolicyFields()}</div><div class="form-actions"><span></span><span></span><button class="button" type="button" data-close>Annulla</button><button class="button primary">Crea</button></div></form>`);
  const form = document.querySelector("#user-form");
  const guest = document.querySelector("#new-guest-policy");
  const updateRole = () => { guest.hidden = form.elements.role.value !== "guest"; };
  form.elements.role.addEventListener("change", updateRole);
  bindGuestControls(form);
  updateRole();
  form.addEventListener("submit", async (event) => { event.preventDefault(); try { const created = await request("/admin/utenti/crea", Object.fromEntries(new FormData(event.currentTarget))); await reload("Utente creato"); drawer("Verifica 2FA di " + escapeHtml(created.user.name), `<div class="stack"><p class="muted">Comunica questa chiave direttamente alla persona. Viene mostrata una sola volta.</p><div class="secret"><small class="muted">Chiave TOTP</small><div class="mono setup-secret">${escapeHtml(created.secret)}</div></div><button class="button primary" data-close>Ho salvato la chiave</button></div>`); } catch (cause) { error(event.currentTarget, cause.message); } });
}

function drawer(title, content) {
  closeDrawer();
  document.body.insertAdjacentHTML("beforeend", `<aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title"><header class="drawer-header"><h2 id="drawer-title">${title}</h2><button class="close" data-close aria-label="Chiudi">×</button></header>${content}</aside>`);
  document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", closeDrawer));
  document.querySelector(".drawer input:not([type=hidden])")?.focus();
}

function closeDrawer() { document.querySelector(".drawer")?.remove(); }

async function reload(message) {
  Object.assign(state, await request("/admin/pannello"));
  render();
  announce(message);
}

(async () => {
  try { const status = await request("/auth/stato"); status.configurazione_richiesta ? setup() : await load(); }
  catch (cause) { auth("Puttit non disponibile", cause.message, ""); }
})();
