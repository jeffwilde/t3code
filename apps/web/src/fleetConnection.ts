import type { EnvironmentId } from "@t3tools/contracts";
import {
  connectionRoutes,
  routeHttpBaseUrl,
  type ConnectionCatalogEntry,
} from "@t3tools/client-runtime/connection";

/** Plan before accepting a pairing code: never replace a known environment or route. */
export function planFleetConnection(input: {
  readonly entries: ReadonlyMap<EnvironmentId, ConnectionCatalogEntry>;
  readonly environmentId: EnvironmentId;
  readonly origin: string;
}): "present" | "pair" | "conflict" {
  let origin: URL;
  try {
    origin = new URL(input.origin);
  } catch {
    return "conflict";
  }
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  )
    return "conflict";
  const normalized = origin.origin;
  let known: "absent" | "present" | "mismatch" = "absent";
  for (const [id, entry] of input.entries) {
    const matches = connectionRoutes(entry).some((route) => {
      const address = routeHttpBaseUrl(route);
      if (address === null) return false;
      try {
        return new URL(address).origin === normalized;
      } catch {
        return false;
      }
    });
    if (matches && id !== input.environmentId) return "conflict";
    if (id === input.environmentId) known = matches && entry.enabled ? "present" : "mismatch";
  }
  return known === "present" ? "present" : known === "mismatch" ? "conflict" : "pair";
}
