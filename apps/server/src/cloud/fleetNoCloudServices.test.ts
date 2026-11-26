import { expect, it, vi } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as AgentAwarenessRelay from "../relay/AgentAwarenessRelay.ts";
import * as ConnectReachability from "./ConnectReachability.ts";

it("fleet-disabled services cannot access stored state, connectors or network", async () => {
  const relay = AgentAwarenessRelay.fleetDisabledService();
  const reachability = ConnectReachability.fleetDisabledService();
  // No secret store, connector, HTTP client or other services are provided.
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* relay.start();
        yield* relay.requestCatchUp();
        yield* relay.publishThread("thread" as never);
        yield* relay.drain;
        const result = yield* reachability.check;
        expect(result.status).toBe("unreachable");
        expect(result.status === "unreachable" && result.cause).toBe("not_linked");
        expect((yield* reachability.latest)._tag).toBe("None");
      }),
    ),
  );
});

it("fleet constructors ignore persisted cloud state and a running connector", async () => {
  vi.stubGlobal("__T3CODE_FLEET_PRIVATE__", true);
  vi.resetModules();
  try {
    const agent = await import("../relay/AgentAwarenessRelay.ts");
    const reachability = await import("./ConnectReachability.ts");
    // Intentionally supply no services: any read of persisted state or connector access fails.
    const relay = await Effect.runPromise(
      Effect.scoped(
        agent.make as unknown as Effect.Effect<
          AgentAwarenessRelay.AgentAwarenessRelay["Service"],
          never,
          never
        >,
      ),
    );
    const service = await Effect.runPromise(
      Effect.scoped(
        reachability.make as unknown as Effect.Effect<
          ConnectReachability.ConnectReachability["Service"],
          never,
          never
        >,
      ),
    );
    await Effect.runPromise(Effect.scoped(relay.start()));
    await Effect.runPromise(relay.requestCatchUp());
    await Effect.runPromise(relay.publishThread("thread" as never));
    const result = await Effect.runPromise(service.check);
    expect(result.status).toBe("unreachable");
  } finally {
    vi.unstubAllGlobals();
    vi.resetModules();
  }
});
