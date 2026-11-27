/**
 * Read the fleet declaration through the existing Liveplane FeedService.
 * The bearer stays in the Authorization header. It is not a request field.
 * A missing feed falls back to the compile-time pin. An unreadable feed does not.
 */
import { parseFleetTargets } from "./fleetTopology.ts";

declare const __T3CODE_FLEET_LIVEPLANE__: string | undefined;

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export interface FleetLiveplaneRef {
  readonly governingAuthorityId: string;
  readonly liveplaneId: string;
  readonly stateSetId: string;
  readonly audience: string;
  readonly exactKeys: readonly string[];
}

export interface FleetFeedSubscription {
  readonly service: "liveplane.feed.draft.FeedService";
  readonly method: "Subscribe";
  readonly body: {
    readonly stateSet: {
      readonly liveplane: {
        readonly governingAuthorityId: string;
        readonly liveplaneId: string;
      };
      readonly stateSetId: string;
    };
    readonly selector: {
      readonly exactKeys: readonly string[];
    };
  };
  readonly authorization: string;
  readonly accessRequest: {
    readonly audience: string;
    readonly operation: "state.feed";
    readonly governingAuthorityId: string;
    readonly liveplaneId: string;
    readonly stateSetId: string;
    readonly keys: readonly string[];
    readonly nowUnixMs: number;
  };
}

function httpsOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.origin === value &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

function identifier(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER.test(value);
}

export function fleetLiveplaneRefFromBuild(): FleetLiveplaneRef | null {
  const raw = typeof __T3CODE_FLEET_LIVEPLANE__ === "undefined" ? "" : __T3CODE_FLEET_LIVEPLANE__;
  return parseFleetLiveplaneRef(raw);
}

/** Returns null for an empty value and rejects any other malformed document. */
export function parseFleetLiveplaneRef(raw: string): FleetLiveplaneRef | null {
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
    Object.keys(record).length !== 5 ||
    !identifier(record.governingAuthorityId) ||
    !identifier(record.liveplaneId) ||
    !identifier(record.stateSetId) ||
    typeof record.audience !== "string" ||
    !httpsOrigin(record.audience) ||
    !Array.isArray(record.exactKeys) ||
    record.exactKeys.length < 1 ||
    record.exactKeys.length > 32 ||
    !record.exactKeys.every((key) => identifier(key))
  ) {
    return null;
  }
  const exactKeys = record.exactKeys as readonly string[];
  if (new Set(exactKeys).size !== exactKeys.length) return null;
  return {
    governingAuthorityId: record.governingAuthorityId,
    liveplaneId: record.liveplaneId,
    stateSetId: record.stateSetId,
    audience: record.audience,
    exactKeys,
  };
}

export function prepareFleetFeedSubscription(input: {
  readonly ref: FleetLiveplaneRef;
  readonly bearer: string;
  readonly nowUnixMs: number;
}): FleetFeedSubscription | null {
  if (!Number.isSafeInteger(input.nowUnixMs) || input.nowUnixMs < 0) return null;
  if (
    input.bearer.length < 16 ||
    input.bearer.length > 4096 ||
    input.bearer.trim() !== input.bearer ||
    /\s/.test(input.bearer)
  ) {
    return null;
  }
  const body = {
    stateSet: {
      liveplane: {
        governingAuthorityId: input.ref.governingAuthorityId,
        liveplaneId: input.ref.liveplaneId,
      },
      stateSetId: input.ref.stateSetId,
    },
    selector: { exactKeys: input.ref.exactKeys },
  };
  const accessRequest = {
    audience: input.ref.audience,
    operation: "state.feed" as const,
    governingAuthorityId: input.ref.governingAuthorityId,
    liveplaneId: input.ref.liveplaneId,
    stateSetId: input.ref.stateSetId,
    keys: input.ref.exactKeys,
    nowUnixMs: input.nowUnixMs,
  };
  const serialized = JSON.stringify({ body, accessRequest });
  if (serialized.includes(input.bearer)) return null;
  return {
    service: "liveplane.feed.draft.FeedService",
    method: "Subscribe",
    body,
    authorization: `Bearer ${input.bearer}`,
    accessRequest,
  };
}

export interface ResolvedFleetTargets {
  readonly source: "pin" | "feed";
  readonly targets: ReturnType<typeof parseFleetTargets>;
}

/**
 * Prefer one exact-key feed value. Transport failure uses the pin.
 * A present value that is not a target list authorizes nothing.
 */
export async function resolveFleetTargets(input: {
  readonly pinnedJson: string;
  readonly ref: FleetLiveplaneRef | null;
  readonly bearer: string | null;
  readonly nowUnixMs: number;
  readonly readKey: (subscription: FleetFeedSubscription) => Promise<string | null>;
}): Promise<ResolvedFleetTargets> {
  const pinned = parseFleetTargets(input.pinnedJson);
  if (input.ref === null || input.bearer === null) return { source: "pin", targets: pinned };
  const subscription = prepareFleetFeedSubscription({
    ref: input.ref,
    bearer: input.bearer,
    nowUnixMs: input.nowUnixMs,
  });
  if (subscription === null) return { source: "pin", targets: pinned };
  let value: string | null;
  try {
    value = await input.readKey(subscription);
  } catch {
    return { source: "pin", targets: pinned };
  }
  if (value === null) return { source: "pin", targets: pinned };
  return { source: "feed", targets: parseFleetTargets(value) };
}
