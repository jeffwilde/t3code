/** Non-secret Robo client settings injected at fleet build time. */
export interface FleetRoboConfig {
  readonly issuer: string;
  readonly clientId: string;
  readonly audience: string;
}

function httpsOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.origin === value &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

/** Returns null for an empty value and rejects any other malformed document. */
export function parseFleetRoboConfig(raw: string): FleetRoboConfig | null {
  if (raw.trim() === "") return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 3 ||
    typeof record.issuer !== "string" ||
    typeof record.clientId !== "string" ||
    typeof record.audience !== "string" ||
    !httpsOrigin(record.issuer) ||
    !httpsOrigin(record.audience) ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(record.clientId)
  ) {
    return null;
  }
  return { issuer: record.issuer, clientId: record.clientId, audience: record.audience };
}
