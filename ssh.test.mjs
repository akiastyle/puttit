// ssh.test.mjs v0.1.0
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import ssh2 from "ssh2";
import { openSshSession, scanHostKey, serverReachable } from "./ssh.mjs";

const { Server } = ssh2;

test("apre una shell SSH interattiva e scambia dati", async (context) => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const server = new Server({ hostKeys: [privateKey.export({ type: "pkcs1", format: "pem" })] }, (client) => {
    client.on("error", () => {});
    client.on("authentication", (auth) => auth.username === "mario" && auth.method === "password" && auth.password === "segreto" ? auth.accept() : auth.reject());
    client.on("ready", () => client.on("session", (accept) => {
      const session = accept();
      session.on("pty", (acceptPty) => acceptPty());
      session.on("shell", (acceptShell) => {
        const stream = acceptShell();
        stream.write("pronto\r\n");
        stream.on("data", (data) => stream.write(`eco:${data}`));
      });
    }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const port = server.address().port;
  assert.equal(await serverReachable({ host: "127.0.0.1", port }), true);
  const host_key = await scanHostKey({ host: "127.0.0.1", port });
  const terminal = await openSshSession({ host: "127.0.0.1", port, username: "mario", password: "segreto", host_key });
  context.after(() => terminal.close());
  let output = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Output incompleto: ${output}`)), 2_000);
    const check = (data) => {
      output += data.toString();
      if (output.includes("eco:ciao")) { clearTimeout(timer); terminal.off("data", check); resolve(); }
    };
    terminal.on("data", check);
    terminal.write("ciao\n");
  });
  assert.match(output, /eco:ciao/);
});
