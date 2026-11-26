import { EnvironmentId } from "@t3tools/contracts";
import {
  PrimaryConnectionTarget,
  type ConnectionCatalogEntry,
} from "@t3tools/client-runtime/connection";
import * as Option from "effect/Option";
import { describe, expect, it } from "vite-plus/test";
import { planFleetConnection } from "./fleetConnection";

const id = EnvironmentId.make("local-managed");
const other = EnvironmentId.make("other-machine");
const origin = "https://local.example.ts.net:8445";
const entry = (
  environmentId: EnvironmentId,
  url = origin,
  enabled = true,
): ConnectionCatalogEntry => ({
  target: new PrimaryConnectionTarget({
    environmentId,
    label: "test",
    httpBaseUrl: url,
    wsBaseUrl: url.replace("https:", "wss:"),
  }),
  profile: Option.none(),
  enabled,
});

describe("fleet pairing plan", () => {
  it("pairs only when the environment and origin are absent", () => {
    expect(planFleetConnection({ entries: new Map(), environmentId: id, origin })).toBe("pair");
  });
  it("preserves an existing matching connection", () => {
    expect(
      planFleetConnection({ entries: new Map([[id, entry(id)]]), environmentId: id, origin }),
    ).toBe("present");
  });
  it("fails closed on a disabled connection or a different route", () => {
    expect(
      planFleetConnection({
        entries: new Map([[id, entry(id, origin, false)]]),
        environmentId: id,
        origin,
      }),
    ).toBe("conflict");
    expect(
      planFleetConnection({
        entries: new Map([[id, entry(id, "https://other.example")]]),
        environmentId: id,
        origin,
      }),
    ).toBe("conflict");
  });
  it("rejects a shared address even if the correct entry is first", () => {
    expect(
      planFleetConnection({
        entries: new Map([
          [id, entry(id)],
          [other, entry(other)],
        ]),
        environmentId: id,
        origin,
      }),
    ).toBe("conflict");
  });
  it.each([
    "http://local.example",
    "https://user:password@local.example",
    "https://local.example/path",
    "not-a-url",
  ])("rejects unsafe origin %s", (bad) => {
    expect(planFleetConnection({ entries: new Map(), environmentId: id, origin: bad })).toBe(
      "conflict",
    );
  });
});
