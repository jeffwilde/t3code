import * as NodePath from "node:path";

/** Synthetic value only. Real fleet credentials are never written by this check. */
export const FLEET_STORAGE_CANARY_PLAINTEXT = "synthetic-fleet-storage-canary";
export const FLEET_STORAGE_CANARY_FILE = "fleet-storage-canary.bin";

/** Flags that select Chromium's fake keychain or plaintext password store. */
export function mockStorageArgument(argv: readonly string[]): string | null {
  for (const argument of argv) {
    if (argument === "--use-mock-keychain" || argument.startsWith("--use-mock-keychain=")) {
      return argument;
    }
    const separator = argument.indexOf("=");
    const name = separator === -1 ? argument : argument.slice(0, separator);
    const value = separator === -1 ? "" : argument.slice(separator + 1);
    if (name === "--password-store" && (value === "basic" || value === "mock")) {
      return argument;
    }
  }
  return null;
}

export function ciphertextHidesPlaintext(bytes: Uint8Array, plaintext: string): boolean {
  return bytes.byteLength > 0 && !includesText(bytes, plaintext);
}

export function runFleetStorageCanary(input: {
  readonly userDataPath: string;
  readonly encrypt: (value: string) => Uint8Array;
  readonly decrypt: (value: Uint8Array) => string;
  readonly writeFile: (path: string, bytes: Uint8Array) => void;
  readonly readFile: (path: string) => Uint8Array;
}): { readonly path: string; readonly ciphertextBytes: number } {
  if (NodePath.basename(input.userDataPath) !== "t3code-fleet-isolated") {
    throw new Error("Fleet storage canary refused a directory other than t3code-fleet-isolated.");
  }
  const encrypted = Uint8Array.from(input.encrypt(FLEET_STORAGE_CANARY_PLAINTEXT));
  if (!ciphertextHidesPlaintext(encrypted, FLEET_STORAGE_CANARY_PLAINTEXT)) {
    throw new Error("Fleet storage canary stored the plaintext.");
  }
  const path = NodePath.join(input.userDataPath, FLEET_STORAGE_CANARY_FILE);
  input.writeFile(path, encrypted);
  const stored = Uint8Array.from(input.readFile(path));
  if (!bytesEqual(stored, encrypted)) {
    throw new Error("Fleet storage canary read back different ciphertext.");
  }
  if (input.decrypt(stored) !== FLEET_STORAGE_CANARY_PLAINTEXT) {
    throw new Error("Fleet storage canary decrypt did not match.");
  }
  return { path, ciphertextBytes: stored.byteLength };
}

function includesText(bytes: Uint8Array, text: string): boolean {
  const needle = new TextEncoder().encode(text);
  if (needle.byteLength === 0 || needle.byteLength > bytes.byteLength) return false;
  for (let start = 0; start <= bytes.byteLength - needle.byteLength; start += 1) {
    let matches = true;
    for (let index = 0; index < needle.byteLength; index += 1) {
      if (bytes[start + index] !== needle[index]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
