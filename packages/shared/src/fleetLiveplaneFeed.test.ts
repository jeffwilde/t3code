import { expect, it } from "vite-plus/test";

import {
  fleetLiveplaneRefFromBuild,
  parseFleetLiveplaneRef,
  prepareFleetFeedSubscription,
  resolveFleetTargets,
} from "./fleetLiveplaneFeed.ts";

const ref = {
  governingAuthorityId: "robo",
  liveplaneId: "nixfig",
  stateSetId: "fleet",
  audience: "https://liveplane.example",
  exactKeys: ["t3.fleet.v1"],
};

it("builds a FeedService subscribe request with the bearer only in the header", () => {
  const bearer = "capability-token-value";
  const subscription = prepareFleetFeedSubscription({ ref, bearer, nowUnixMs: 1_800_000_000_000 });
  expect(subscription).toMatchObject({
    service: "liveplane.feed.draft.FeedService",
    method: "Subscribe",
    body: {
      stateSet: {
        liveplane: { governingAuthorityId: "robo", liveplaneId: "nixfig" },
        stateSetId: "fleet",
      },
      selector: { exactKeys: ["t3.fleet.v1"] },
    },
    accessRequest: { operation: "state.feed", stateSetId: "fleet", nowUnixMs: 1_800_000_000_000 },
  });
  expect(subscription?.authorization).toBe(`Bearer ${bearer}`);
  expect(JSON.stringify(subscription?.body)).not.toContain(bearer);
  expect(JSON.stringify(subscription?.accessRequest)).not.toContain(bearer);
  expect(Object.keys(subscription?.body ?? {})).toEqual(["stateSet", "selector"]);
});

it("leaves the feed unconfigured until a fleet build supplies a reference", () => {
  expect(fleetLiveplaneRefFromBuild()).toBeNull();
});

it("accepts only a non-secret Liveplane reference", () => {
  expect(parseFleetLiveplaneRef("")).toBeNull();
  expect(parseFleetLiveplaneRef(JSON.stringify(ref))).toEqual(ref);
  expect(parseFleetLiveplaneRef(JSON.stringify({ ...ref, bearer: "capability-token-value" }))).toBeNull();
  expect(parseFleetLiveplaneRef(JSON.stringify({ ...ref, audience: "https://user:secret@liveplane.example" }))).toBeNull();
});

it("uses a feed target list and keeps the pin when the feed is absent", async () => {
  const pinned = JSON.stringify([{ environmentId: "pinned", origin: "https://pinned.example:8445" }]);
  const fed = JSON.stringify([{ environmentId: "fed", origin: "https://fed.example:8445" }]);
  const bearer = "capability-token-value";
  const fromFeed = await resolveFleetTargets({
    pinnedJson: pinned,
    ref,
    bearer,
    nowUnixMs: 10,
    readKey: async (subscription) => {
      expect(subscription.authorization).toBe(`Bearer ${bearer}`);
      expect(JSON.stringify(subscription.body)).not.toContain(bearer);
      return fed;
    },
  });
  expect(fromFeed).toEqual({
    source: "feed",
    targets: [{ environmentId: "fed", origin: "https://fed.example:8445" }],
  });
  const absent = await resolveFleetTargets({
    pinnedJson: pinned,
    ref,
    bearer,
    nowUnixMs: 10,
    readKey: async () => null,
  });
  expect(absent.source).toBe("pin");
  expect(absent.targets).toEqual([{ environmentId: "pinned", origin: "https://pinned.example:8445" }]);
  const unreadable = await resolveFleetTargets({
    pinnedJson: pinned,
    ref,
    bearer,
    nowUnixMs: 10,
    readKey: async () => "not-a-target-list",
  });
  expect(unreadable).toEqual({ source: "feed", targets: null });
});

it("rejects a bearer that would be copied into the state request", () => {
  expect(prepareFleetFeedSubscription({ ref, bearer: "short", nowUnixMs: 1 })).toBeNull();
  expect(
    prepareFleetFeedSubscription({
      ref: { ...ref, stateSetId: "capability-token-value" },
      bearer: "capability-token-value",
      nowUnixMs: 1,
    }),
  ).toBeNull();
});
