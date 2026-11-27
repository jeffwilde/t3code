import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import {
  CatalogReencryptError,
  reencryptCatalog,
  type CatalogCipherIdentity,
} from "./catalogReencrypt.ts";

const CATALOG_FILE = "connection-catalog.json";
const VENDOR_COPY = "connection-catalog.vendor-ciphertext";
const ISOLATED_DIRECTORY = "t3code-fleet-isolated";
const VENDOR_DIRECTORY = "t3code-v2";

export class CatalogMigrationError extends Error {
  readonly reason:
    | "destination-not-isolated"
    | "destination-exists"
    | "source-changed"
    | "source-unreadable"
    | "destination-unreadable";

  constructor(reason: CatalogMigrationError["reason"]) {
    super(
      reason === "destination-not-isolated"
        ? "A fleet catalog can be written only in the isolated catalog home."
        : reason === "destination-exists"
          ? "The isolated catalog already exists."
          : reason === "source-changed"
            ? "The vendor catalog changed before the copy finished."
            : reason === "source-unreadable"
              ? "The current app could not read the connection catalog."
              : "The replacement app could not read the catalog it wrote.",
    );
    this.name = "CatalogMigrationError";
    this.reason = reason;
  }
}

function catalogDirectoryName(filePath: string): string | undefined {
  const parts = NodePath.resolve(filePath).split(NodePath.sep);
  if (parts.at(-1) !== CATALOG_FILE) return undefined;
  return parts.at(-2);
}

export function isolatedCatalogDestination(filePath: string): boolean {
  return catalogDirectoryName(filePath) === ISOLATED_DIRECTORY;
}

async function writeExclusive(filePath: string, bytes: Uint8Array): Promise<void> {
  const handle = await NodeFSP.open(filePath, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
  } finally {
    await handle.close();
  }
}

/**
 * Copy a catalog onto the isolated home. The source file is read and then
 * left unchanged, including when the copy cannot be encrypted for the new identity.
 */
export async function migrateCatalogFile(input: {
  readonly sourcePath: string;
  readonly destinationPath: string;
  readonly source: CatalogCipherIdentity;
  readonly destination: CatalogCipherIdentity;
}): Promise<void> {
  const requestedDestination = NodePath.resolve(input.destinationPath);
  if (
    !isolatedCatalogDestination(requestedDestination) ||
    catalogDirectoryName(requestedDestination) === VENDOR_DIRECTORY
  ) {
    throw new CatalogMigrationError("destination-not-isolated");
  }
  const destinationDirectory = await NodeFSP.realpath(NodePath.dirname(requestedDestination));
  const destinationPath = NodePath.join(destinationDirectory, CATALOG_FILE);
  if (!isolatedCatalogDestination(destinationPath)) {
    throw new CatalogMigrationError("destination-not-isolated");
  }
  const sourcePath = await NodeFSP.realpath(input.sourcePath);
  if (
    sourcePath === destinationPath ||
    sourcePath.startsWith(`${destinationDirectory}${NodePath.sep}`)
  ) {
    throw new CatalogMigrationError("destination-not-isolated");
  }

  const preserved = Buffer.from(await NodeFSP.readFile(sourcePath));
  let migrated: Uint8Array;
  try {
    migrated = reencryptCatalog({
      source: input.source,
      destination: input.destination,
      sourceCiphertext: preserved,
    });
  } catch (error) {
    if (error instanceof CatalogReencryptError) {
      throw new CatalogMigrationError(error.reason);
    }
    throw error;
  }
  if (!Buffer.from(await NodeFSP.readFile(sourcePath)).equals(preserved)) {
    throw new CatalogMigrationError("source-changed");
  }

  const vendorCopyPath = NodePath.join(destinationDirectory, VENDOR_COPY);
  const destinationBytes = Buffer.from(migrated);
  let wroteVendorCopy = false;
  let wroteDestination = false;
  try {
    await writeExclusive(vendorCopyPath, preserved);
    wroteVendorCopy = true;
    await writeExclusive(destinationPath, destinationBytes);
    wroteDestination = true;
  } catch (error) {
    if (wroteDestination) await NodeFSP.rm(destinationPath, { force: true });
    if (wroteVendorCopy) await NodeFSP.rm(vendorCopyPath, { force: true });
    if (isAlreadyExists(error)) throw new CatalogMigrationError("destination-exists");
    throw error;
  }
  if (!Buffer.from(await NodeFSP.readFile(sourcePath)).equals(preserved)) {
    await NodeFSP.rm(destinationPath, { force: true });
    await NodeFSP.rm(vendorCopyPath, { force: true });
    throw new CatalogMigrationError("source-changed");
  }
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}
