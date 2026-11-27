import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";

import { CatalogMigrationError, migrateCatalogFile } from "./catalogMigration.ts";
import type { CatalogCipherIdentity } from "./catalogReencrypt.ts";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function identity(name: string): CatalogCipherIdentity {
  const prefix = `${name}:`;
  return {
    encrypt: (plaintext) => textEncoder.encode(prefix + plaintext),
    decrypt: (ciphertext) => {
      const text = textDecoder.decode(ciphertext);
      if (!text.startsWith(prefix)) throw new Error("different key");
      return text.slice(prefix.length);
    },
  };
}

async function homes(): Promise<{ root: string; vendorCatalog: string; isolatedCatalog: string }> {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-catalog-migration-"));
  const vendor = NodePath.join(root, "t3code-v2");
  const isolated = NodePath.join(root, "t3code-fleet-isolated");
  await NodeFSP.mkdir(vendor);
  await NodeFSP.mkdir(isolated);
  const vendorCatalog = NodePath.join(vendor, "connection-catalog.json");
  await NodeFSP.writeFile(vendorCatalog, identity("vendor").encrypt("saved-connections"), {
    mode: 0o600,
  });
  return { root, vendorCatalog, isolatedCatalog: NodePath.join(isolated, "connection-catalog.json") };
}

describe("catalog migration", () => {
  it("copies the catalog into the isolated home and leaves the vendor file unchanged", async () => {
    const { root, vendorCatalog, isolatedCatalog } = await homes();
    try {
      const before = await NodeFSP.readFile(vendorCatalog);
      await migrateCatalogFile({
        sourcePath: vendorCatalog,
        destinationPath: isolatedCatalog,
        source: identity("vendor"),
        destination: identity("fleet"),
      });
      const after = await NodeFSP.readFile(vendorCatalog);
      const destination = await NodeFSP.readFile(isolatedCatalog);
      const preserved = await NodeFSP.readFile(
        NodePath.join(NodePath.dirname(isolatedCatalog), "connection-catalog.vendor-ciphertext"),
      );
      assert.deepStrictEqual(after, before);
      assert.deepStrictEqual(preserved, before);
      assert.equal(identity("fleet").decrypt(destination), "saved-connections");
      assert.throws(() => identity("vendor").decrypt(destination));
      assert.deepStrictEqual(await NodeFSP.readdir(NodePath.dirname(vendorCatalog)), [
        "connection-catalog.json",
      ]);
    } finally {
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  });

  it("writes nothing when the vendor ciphertext cannot be read", async () => {
    const { root, vendorCatalog, isolatedCatalog } = await homes();
    try {
      const before = await NodeFSP.readFile(vendorCatalog);
      let caught: unknown;
      try {
        await migrateCatalogFile({
          sourcePath: vendorCatalog,
          destinationPath: isolatedCatalog,
          source: identity("other"),
          destination: identity("fleet"),
        });
      } catch (error) {
        caught = error;
      }
      assert.instanceOf(caught, CatalogMigrationError);
      assert.equal(caught instanceof CatalogMigrationError && caught.reason, "source-unreadable");
      assert.deepStrictEqual(await NodeFSP.readFile(vendorCatalog), before);
      assert.deepStrictEqual(await NodeFSP.readdir(NodePath.dirname(isolatedCatalog)), []);
    } finally {
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  });

  it("refuses to write a catalog into the vendor home", async () => {
    const { root, vendorCatalog } = await homes();
    try {
      const before = await NodeFSP.readFile(vendorCatalog);
      let caught: unknown;
      try {
        await migrateCatalogFile({
          sourcePath: vendorCatalog,
          destinationPath: vendorCatalog,
          source: identity("vendor"),
          destination: identity("fleet"),
        });
      } catch (error) {
        caught = error;
      }
      assert.instanceOf(caught, CatalogMigrationError);
      assert.equal(
        caught instanceof CatalogMigrationError && caught.reason,
        "destination-not-isolated",
      );
      assert.deepStrictEqual(await NodeFSP.readFile(vendorCatalog), before);
    } finally {
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  });

  it("refuses a destination directory that resolves to the vendor home", async () => {
    const { root, vendorCatalog } = await homes();
    const linked = NodePath.join(root, "t3code-fleet-isolated-link");
    await NodeFSP.symlink(NodePath.join(root, "t3code-v2"), linked);
    try {
      const before = await NodeFSP.readFile(vendorCatalog);
      let caught: unknown;
      try {
        await migrateCatalogFile({
          sourcePath: vendorCatalog,
          destinationPath: NodePath.join(linked, "connection-catalog.json"),
          source: identity("vendor"),
          destination: identity("fleet"),
        });
      } catch (error) {
        caught = error;
      }
      assert.instanceOf(caught, CatalogMigrationError);
      assert.equal(
        caught instanceof CatalogMigrationError && caught.reason,
        "destination-not-isolated",
      );
      assert.deepStrictEqual(await NodeFSP.readFile(vendorCatalog), before);
      assert.deepStrictEqual(await NodeFSP.readdir(NodePath.dirname(vendorCatalog)), [
        "connection-catalog.json",
      ]);
    } finally {
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  });
});
