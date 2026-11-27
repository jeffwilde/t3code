import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, it } from "@effect/vitest";

import {
  FLEET_STORAGE_CANARY_PLAINTEXT,
  mockStorageArgument,
  runFleetStorageCanary,
} from "./fleetStorageCanary.ts";

it("recognizes mock keychain and plaintext password-store flags", () => {
  assert.equal(mockStorageArgument(["electron", "main.cjs"]), null);
  assert.equal(mockStorageArgument(["--use-mock-keychain"]), "--use-mock-keychain");
  assert.equal(mockStorageArgument(["--password-store=basic"]), "--password-store=basic");
  assert.equal(mockStorageArgument(["--password-store=mock"]), "--password-store=mock");
  assert.equal(mockStorageArgument(["--password-store=gnome-libsecret"]), null);
});

it("round-trips a synthetic canary only inside the isolated directory", () => {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-fleet-canary-"));
  const userDataPath = NodePath.join(directory, "t3code-fleet-isolated");
  NodeFS.mkdirSync(userDataPath);
  const files = new Map<string, Uint8Array>();
  try {
    const result = runFleetStorageCanary({
      userDataPath,
      encrypt: (value) => Uint8Array.from(new TextEncoder().encode(value), (byte) => byte ^ 0xff),
      decrypt: (value) => new TextDecoder().decode(Uint8Array.from(value, (byte) => byte ^ 0xff)),
      writeFile: (path, bytes) => {
        files.set(path, bytes);
      },
      readFile: (path) => files.get(path) ?? new Uint8Array(),
    });
    assert.equal(NodePath.basename(result.path), "fleet-storage-canary.bin");
    assert.isAbove(result.ciphertextBytes, 0);
    assert.throws(
      () =>
        runFleetStorageCanary({
          userDataPath: NodePath.join(directory, "t3code-v2"),
          encrypt: (value) => new TextEncoder().encode(value),
          decrypt: (value) => new TextDecoder().decode(value),
          writeFile: () => undefined,
          readFile: () => new Uint8Array(),
        }),
      /t3code-fleet-isolated/,
    );
  } finally {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});
