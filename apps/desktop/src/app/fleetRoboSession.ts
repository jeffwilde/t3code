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
