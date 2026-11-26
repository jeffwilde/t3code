/** A build-pinned allowlist of non-secret target identities, never credentials. */
declare const __T3CODE_FLEET_TARGETS__: string | undefined;

type Target = { readonly environmentId: string; readonly origin: string };

export function parseFleetTargets(raw: string): readonly Target[] | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(value) || value.length > 128) return null;
  const targets: Target[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    if (
      Object.keys(record).length !== 2 ||
      typeof record.environmentId !== "string" ||
      !record.environmentId.trim() ||
      typeof record.origin !== "string"
    )
      return null;
    let origin: URL;
    try {
      origin = new URL(record.origin);
    } catch {
      return null;
    }
    if (
      origin.protocol !== "https:" ||
      origin.username ||
      origin.password ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash ||
      origin.origin !== record.origin
    )
      return null;
    if (
      targets.some(
        (target) =>
          target.environmentId === record.environmentId || target.origin === record.origin,
      )
    )
      return null;
    targets.push({ environmentId: record.environmentId, origin: record.origin });
  }
  return targets;
}

export function permitsFleetTarget(environmentId: string, origin: string): boolean {
  const targets = parseFleetTargets(
    typeof __T3CODE_FLEET_TARGETS__ === "undefined" ? "[]" : __T3CODE_FLEET_TARGETS__,
  );
  return (
    targets?.some((target) => target.environmentId === environmentId && target.origin === origin) ??
    false
  );
}
