// runtime.test.mjs v0.1.0
import assert from "node:assert/strict";
import test from "node:test";
import {
  clearRuntime, consumeApproval, decideApproval, finishSession,
  onAlert, registerSession, requestApproval, runtimeSnapshot, stopSession,
} from "./runtime.mjs";

test("l'admin decide le richieste e chiude le sessioni senza vedere il terminale", () => {
  clearRuntime();
  const alerts = [];
  const unsubscribe = onAlert((event) => alerts.push(event));
  const details = { access_id: "accesso-1", user_id: "utente-1", user_name: "Mario", server_name: "Produzione" };
  const pending = requestApproval(details);
  assert.equal(requestApproval(details).id, pending.id);
  assert.equal(runtimeSnapshot().requests.length, 1);
  decideApproval(pending.id, true);
  assert.deepEqual(consumeApproval(pending.id, details.user_id), { status: "approved" });

  let closedWith;
  const active = registerSession(details, (reason) => { closedWith = reason; }, 600);
  const visible = runtimeSnapshot().sessions[0];
  assert.equal(visible.user_name, "Mario");
  assert.equal("close" in visible, false);
  assert.equal("command" in visible, false);
  stopSession(active.id);
  assert.equal(closedWith, "closed_by_admin");
  finishSession(active.id);
  assert.equal(runtimeSnapshot().sessions.length, 0);
  assert.throws(() => registerSession(details, () => {}, 601), /Durata/);
  assert.deepEqual(alerts.map((event) => event.type), ["approval_requested", "session_started", "session_stopped"]);
  assert.equal(alerts.some((event) => "command" in event || "output" in event), false);
  unsubscribe();
  clearRuntime();
});
