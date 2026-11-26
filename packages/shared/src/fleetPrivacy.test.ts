import { afterEach, expect, it, vi } from "vite-plus/test";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("keeps OTEL and relay export disabled in a fleet build even when explicitly enabled", async () => {
  vi.stubGlobal("__T3CODE_FLEET_PRIVATE__", true);
  vi.resetModules();
  const otel = await import("./otelEnvironment.ts");
  const env = {
    T3CODE_OTEL_SDK_DISABLED: "false",
    T3CODE_TELEMETRY_ENABLED: "true",
    OTEL_EXPORTER_OTLP_ENDPOINT: "https://example.test",
  };
  const result = await Effect.runPromise(
    otel.load.pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env })))),
  );
  expect(result.disabled).toBe(true);
  expect(result.traces._tag).toBe("Unset");
  expect(otel.isRelayTracingEnabled(env)).toBe(false);
});
