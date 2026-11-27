// A later signature cannot read the vendor catalog key. Copy the plaintext
// through the identity that can still decrypt, then keep the original ciphertext.

export class CatalogReencryptError extends Error {
  readonly reason: "source-unreadable" | "destination-unreadable";

  constructor(reason: CatalogReencryptError["reason"]) {
    super(
      reason === "source-unreadable"
        ? "The current app could not read the connection catalog."
        : "The replacement app could not read the catalog it wrote.",
    );
    this.name = "CatalogReencryptError";
    this.reason = reason;
  }
}

export interface CatalogCipherIdentity {
  readonly encrypt: (plaintext: string) => Uint8Array;
  readonly decrypt: (ciphertext: Uint8Array) => string;
}

export function reencryptCatalog(input: {
  readonly source: CatalogCipherIdentity;
  readonly destination: CatalogCipherIdentity;
  readonly sourceCiphertext: Uint8Array;
}): Uint8Array {
  const sourceCiphertext = input.sourceCiphertext;
  let plaintext: string;
  try {
    plaintext = input.source.decrypt(sourceCiphertext);
  } catch {
    throw new CatalogReencryptError("source-unreadable");
  }
  const destinationCiphertext = input.destination.encrypt(plaintext);
  let roundTrip: string;
  try {
    roundTrip = input.destination.decrypt(destinationCiphertext);
  } catch {
    throw new CatalogReencryptError("destination-unreadable");
  }
  if (roundTrip !== plaintext || destinationCiphertext === sourceCiphertext) {
    throw new CatalogReencryptError("destination-unreadable");
  }
  return destinationCiphertext;
}
