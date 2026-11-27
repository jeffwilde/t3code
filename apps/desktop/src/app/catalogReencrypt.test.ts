import { assert, describe, it } from "@effect/vitest";

import { CatalogReencryptError, reencryptCatalog, type CatalogCipherIdentity } from "./catalogReencrypt.ts";

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

describe("catalog re-encryption", () => {
  it("copies a catalog onto a new identity and leaves the source ciphertext unchanged", () => {
    const source = identity("vendor");
    const destination = identity("fleet");
    const plaintext = '{"schemaVersion":1,"targets":[{"origin":"https://macked.bee-lime.ts.net:8445"}]}';
    const sourceCiphertext = source.encrypt(plaintext);
    const before = sourceCiphertext.slice();
    const destinationCiphertext = reencryptCatalog({
      source,
      destination,
      sourceCiphertext,
    });

    assert.deepStrictEqual(sourceCiphertext, before);
    assert.equal(destination.decrypt(destinationCiphertext), plaintext);
    assert.throws(() => source.decrypt(destinationCiphertext));
    assert.throws(() => destination.decrypt(sourceCiphertext));
  });

  it("does not return a replacement when the new identity cannot read its own write", () => {
    const source = identity("vendor");
    const plaintext = "catalog";
    const sourceCiphertext = source.encrypt(plaintext);
    const destination: CatalogCipherIdentity = {
      encrypt: () => textEncoder.encode("sealed"),
      decrypt: () => {
        throw new Error("keychain denied");
      },
    };

    let caught: unknown;
    try {
      reencryptCatalog({ source, destination, sourceCiphertext });
    } catch (error) {
      caught = error;
    }
    assert.instanceOf(caught, CatalogReencryptError);
    assert.equal(caught instanceof CatalogReencryptError && caught.reason, "destination-unreadable");
    assert.equal(source.decrypt(sourceCiphertext), plaintext);
  });

  it("rejects a destination write that repeats the source bytes", () => {
    const source = identity("vendor");
    const plaintext = "catalog";
    const sourceCiphertext = source.encrypt(plaintext);
    const destination: CatalogCipherIdentity = {
      encrypt: () => sourceCiphertext.slice(),
      decrypt: () => plaintext,
    };

    let caught: unknown;
    try {
      reencryptCatalog({ source, destination, sourceCiphertext });
    } catch (error) {
      caught = error;
    }
    assert.instanceOf(caught, CatalogReencryptError);
    assert.equal(caught instanceof CatalogReencryptError && caught.reason, "destination-unreadable");
    assert.equal(source.decrypt(sourceCiphertext), plaintext);
  });

  it("refuses a source ciphertext the current identity cannot read", () => {
    let caught: unknown;
    try {
      reencryptCatalog({
        source: identity("vendor"),
        destination: identity("fleet"),
        sourceCiphertext: textEncoder.encode("other:catalog"),
      });
    } catch (error) {
      caught = error;
    }
    assert.instanceOf(caught, CatalogReencryptError);
    assert.equal(caught instanceof CatalogReencryptError && caught.reason, "source-unreadable");
  });
});
