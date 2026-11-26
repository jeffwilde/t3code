import { afterEach, expect, it, vi } from "vite-plus/test";
import { parseFleetTargets } from "./fleetTopology.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("rejects malformed, duplicate, secret-bearing, and noncanonical policies", () => {
  for (const value of [
    "bad",
    JSON.stringify([{ environmentId: "one", origin: "http://host" }]),
    JSON.stringify([{ environmentId: "one", origin: "https://host", token: "secret" }]),
    JSON.stringify([{ environmentId: "one", origin: "https://host/path" }]),
    JSON.stringify([
      { environmentId: "one", origin: "https://host" },
      { environmentId: "other", origin: "https://host" },
    ]),
  ])
    expect(parseFleetTargets(value)).toBeNull();
});

it("permits only an exact build-pinned identity and origin", async () => {
  vi.stubGlobal(
    "__T3CODE_FLEET_TARGETS__",
    JSON.stringify([{ environmentId: "one", origin: "https://host.example:8445" }]),
  );
  vi.resetModules();
  const policy = await import("./fleetTopology.ts");
  expect(policy.permitsFleetTarget("one", "https://host.example:8445")).toBe(true);
  expect(policy.permitsFleetTarget("other", "https://host.example:8445")).toBe(false);
  expect(policy.permitsFleetTarget("one", "https://other.example:8445")).toBe(false);
});
