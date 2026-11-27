import { expect, it } from "vite-plus/test";

import { parseFleetRoboConfig } from "./fleetRoboConfig.ts";

const valid = JSON.stringify({
  issuer: "https://auth-test.robo.ai",
  clientId: "t3-test-desktop",
  audience: "https://t3-test.robo.ai",
});

it("accepts an exact https issuer and audience", () => {
  expect(parseFleetRoboConfig(valid)).toEqual({
    issuer: "https://auth-test.robo.ai",
    clientId: "t3-test-desktop",
    audience: "https://t3-test.robo.ai",
  });
});

it("accepts the deployed T3 desktop clients", () => {
  expect(
    parseFleetRoboConfig(
      JSON.stringify({
        issuer: "https://auth.robo.ai",
        clientId: "t3-desktop",
        audience: "https://t3.robo.ai",
      }),
    ),
  ).toEqual({
    issuer: "https://auth.robo.ai",
    clientId: "t3-desktop",
    audience: "https://t3.robo.ai",
  });
  expect(
    parseFleetRoboConfig(
      JSON.stringify({
        issuer: "https://auth-test.robo.ai",
        clientId: "t3-test-desktop",
        audience: "https://t3-test.robo.ai",
      }),
    ),
  ).toEqual({
    issuer: "https://auth-test.robo.ai",
    clientId: "t3-test-desktop",
    audience: "https://t3-test.robo.ai",
  });
});

it("treats an empty document as unconfigured", () => {
  expect(parseFleetRoboConfig("")).toBeNull();
  expect(parseFleetRoboConfig("  ")).toBeNull();
});

it("rejects credentials, paths, and extra fields", () => {
  expect(parseFleetRoboConfig("not-json")).toBeNull();
  expect(
    parseFleetRoboConfig(
      JSON.stringify({
        issuer: "https://user:secret@auth-test.robo.ai",
        clientId: "t3-test-desktop",
        audience: "https://t3-test.robo.ai",
      }),
    ),
  ).toBeNull();
  expect(
    parseFleetRoboConfig(
      JSON.stringify({
        issuer: "https://auth-test.robo.ai/path",
        clientId: "t3-test-desktop",
        audience: "https://t3-test.robo.ai",
      }),
    ),
  ).toBeNull();
  expect(parseFleetRoboConfig(valid.slice(0, -1) + ',"token":"x"}')).toBeNull();
});
