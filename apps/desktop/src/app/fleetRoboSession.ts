/** In-memory result of a verified Robo sign-in. Tokens stay in OS custody. */
export interface VerifiedFleetIdentity {
  readonly subject: string;
  readonly audience: string;
  readonly expiresAtMs: number;
}

let current: VerifiedFleetIdentity | null = null;

export function currentFleetIdentity(nowMs: number): VerifiedFleetIdentity | null {
  if (current === null || current.expiresAtMs <= nowMs) return null;
  return current;
}

export function rememberVerifiedFleetIdentity(identity: VerifiedFleetIdentity): void {
  current = identity;
}

export function clearVerifiedFleetIdentity(): void {
  current = null;
}

const FLEET_SUBJECT = /^(?:google:[a-f0-9]{64}|robo:[A-Za-z0-9_-]{16,64})$/;

function httpsOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

/** Sealed claims for a later restart. This is not an access token. */
export function encodeFleetIdentity(identity: VerifiedFleetIdentity): string {
  return JSON.stringify({
    v: 1,
    subject: identity.subject,
    audience: identity.audience,
    expiresAtMs: identity.expiresAtMs,
  });
}

export function decodeFleetIdentity(
  raw: string,
  nowMs: number,
  audience: string,
): VerifiedFleetIdentity | null {
  if (raw.length === 0 || raw.length > 1024 || !Number.isSafeInteger(nowMs) || !httpsOrigin(audience)) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (record.v !== 1 || record.audience !== audience) return null;
  if (typeof record.subject !== "string" || !FLEET_SUBJECT.test(record.subject)) return null;
  if (
    typeof record.expiresAtMs !== "number" ||
    !Number.isSafeInteger(record.expiresAtMs) ||
    record.expiresAtMs <= nowMs
  ) {
    return null;
  }
  return { subject: record.subject, audience, expiresAtMs: record.expiresAtMs };
}
