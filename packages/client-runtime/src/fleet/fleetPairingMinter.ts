import * as NodeCrypto from "node:crypto";

import { verifyRoboIdentity } from "./verifyRobo.mjs";

const SUBJECT = /^(?:google:[a-f0-9]{64}|robo:[A-Za-z0-9_-]{16,64}|robo-test:[A-Za-z0-9_-]{1,64})$/;

interface OutstandingCode {
  readonly subject: string;
  readonly expiresAtMs: number;
}

export interface FleetPairingMinter {
  issue(input: { readonly subject: string; readonly nowMs: number }): {
    readonly code: string;
    readonly expiresAtMs: number;
  } | null;
  redeem(input: { readonly code: string; readonly subject: string; readonly nowMs: number }): boolean;
}

/** One-time pairing codes stay in this process. Only their hashes are retained. */
export function createFleetPairingMinter(input: {
  readonly randomCode: () => string;
  readonly ttlMs: number;
}): FleetPairingMinter {
  const outstanding = new Map<string, OutstandingCode>();
  return {
    issue({ subject, nowMs }) {
      if (!SUBJECT.test(subject) || !Number.isSafeInteger(nowMs)) return null;
      if (!Number.isSafeInteger(input.ttlMs) || input.ttlMs < 1_000 || input.ttlMs > 120_000) {
        return null;
      }
      const code = input.randomCode();
      if (code.length < 32 || code.length > 128 || /\s/.test(code)) return null;
      const digest = NodeCrypto.createHash("sha256").update(code).digest("hex");
      if (outstanding.has(digest)) return null;
      const expiresAtMs = nowMs + input.ttlMs;
      outstanding.set(digest, { subject, expiresAtMs });
      return { code, expiresAtMs };
    },
    redeem({ code, subject, nowMs }) {
      const digest = NodeCrypto.createHash("sha256").update(code).digest("hex");
      const row = outstanding.get(digest);
      outstanding.delete(digest);
      return row !== undefined && row.subject === subject && row.expiresAtMs > nowMs;
    },
  };
}

export function randomFleetPairingCode(): string {
  return NodeCrypto.randomBytes(32).toString("base64url");
}

export async function issueVerifiedFleetPairingCode(input: {
  readonly token: string;
  readonly issuer: string;
  readonly audience: string;
  readonly fetchJwks: (url: string) => Promise<Response>;
  readonly nowMs: number;
  readonly minter: FleetPairingMinter;
  readonly allowSyntheticTestSubject?: boolean;
}): Promise<{ readonly subject: string; readonly code: string; readonly expiresAtMs: number } | null> {
  let identity: { subject: string; expiresAtMs: number };
  try {
    identity = await verifyRoboIdentity({
      token: input.token,
      issuer: input.issuer,
      audience: input.audience,
      fetchJwks: input.fetchJwks,
      now: () => input.nowMs,
      allowSyntheticTestSubject: input.allowSyntheticTestSubject,
    });
  } catch {
    return null;
  }
  const issued = input.minter.issue({ subject: identity.subject, nowMs: input.nowMs });
  if (issued === null) return null;
  return { subject: identity.subject, code: issued.code, expiresAtMs: issued.expiresAtMs };
}