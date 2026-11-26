// @effect-diagnostics nodeBuiltinImport:off -- Exercises the private local socket.
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, expect, it, vi } from "vite-plus/test";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("binds fleet status to the pinned target and refuses all credentials until authorization exists", async () => {
  vi.stubGlobal("__T3CODE_FLEET_PRIVATE__", true);
  vi.stubGlobal(
    "__T3CODE_FLEET_TARGETS__",
    JSON.stringify([{ environmentId: "env", origin: "https://host.example:8445" }]),
  );
  vi.resetModules();
  const { startDesktopAppControlServer } = await import("./DesktopAppActivation.ts");
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-fleet-control-"));
  const socketPath = NodePath.join(root, "app.sock");
  let forwarded = 0;
  const server = await startDesktopAppControlServer({
    address: socketPath,
    directory: root,
    userId: process.getuid?.(),
    handle: async (request) => {
      forwarded++;
      return {
        version: 1,
        requestId: request.requestId,
        ok: false,
        code: "environment-unavailable",
        message: "test",
      };
    },
    cancel: () => {},
    onReclaimError: () => {},
  });
  const send = (request: object) =>
    new Promise<string>((resolve, reject) => {
      const socket = NodeNet.createConnection(socketPath);
      let data = "";
      socket.on("error", reject);
      socket.on("connect", () => socket.write(JSON.stringify(request) + "\n"));
      socket.on("data", (chunk) => {
        data += chunk;
        if (data.includes("\n")) {
          socket.destroy();
          resolve(data);
        }
      });
    });
  try {
    const base = {
      version: 1,
      requestId: "r1",
      type: "fleet-pair",
      environmentId: "env",
      origin: "https://host.example:8445",
    };
    await send(base);
    expect(forwarded).toBe(1);
    expect(await send({ ...base, origin: "https://other.example" })).toContain("not authorized");
    const reply = await send({ ...base, pairingCode: "synthetic-secret" });
    expect(reply).toContain("authorization is not configured");
    expect(reply).not.toContain("synthetic-secret");
    expect(forwarded).toBe(1);
  } finally {
    await server.close();
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});
