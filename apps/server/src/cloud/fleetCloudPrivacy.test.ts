import { afterEach, expect, it, vi } from "vite-plus/test";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("rejects inherited relay and OAuth config in a fleet build", async () => {
  vi.stubGlobal("__T3CODE_FLEET_PRIVATE__", true);
  vi.resetModules();
  const cloud = await import("./publicConfig.ts");
  const env = {
    T3CODE_RELAY_URL: "https://relay.example.test",
    T3CODE_CLERK_PUBLISHABLE_KEY: "pk_test",
    T3CODE_CLERK_CLI_OAUTH_CLIENT_ID: "client",
  };
  const provider = ConfigProvider.layer(ConfigProvider.fromEnv({ env }));
  expect(cloud.hasCloudPublicConfig).toBe(false);
  expect(
    (await Effect.runPromiseExit(cloud.makeRelayUrlConfig().pipe(Effect.provide(provider))))._tag,
  ).toBe("Failure");
  expect(
    (await Effect.runPromiseExit(cloud.makeCloudCliOAuthConfig().pipe(Effect.provide(provider))))
      ._tag,
  ).toBe("Failure");
});
