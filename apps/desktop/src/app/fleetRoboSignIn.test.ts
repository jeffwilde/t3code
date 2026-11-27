import { afterEach, expect, it } from "vite-plus/test";

import {
  generateSigningKey,
  publicJwk,
  signAccessToken,
} from "../../../../packages/client-runtime/src/fleet/testJwtFixture.mjs";
import { clearVerifiedFleetIdentity, currentFleetIdentity, rememberVerifiedFleetIdentity } from "./fleetRoboSession.ts";
import { startFleetRoboSignIn, type FleetSecretStore } from "./fleetRoboSignIn.ts";

const config = {
  issuer: "https://auth-test.robo.ai",
  clientId: "t3-test-desktop",
  audience: "https://t3-test.robo.ai",
};

afterEach(() => {
  clearVerifiedFleetIdentity();
});

function memoryStore(): FleetSecretStore & { readonly saved: Map<string, string> } {
  const saved = new Map<string, string>();
  return {
    saved,
    async put(name, value) {
      saved.set(name, value);
    },
    async get(name) {
      return saved.get(name) ?? null;
    },
  };
}

it("stores a verified Robo subject and keeps the authorization code out of the page", async () => {
  const key = await generateSigningKey("test-key");
  const now = 1_800_000_000_000;
  const accessToken = await signAccessToken(
    {
      iss: config.issuer,
      aud: config.audience,
      sub: "robo:abcdefghijklmnop",
      nbf: Math.floor(now / 1000) - 10,
      exp: Math.floor(now / 1000) + 600,
    },
    key,
  );
  const store = memoryStore();
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/jwks.json") {
      return new Response(JSON.stringify({ keys: [publicJwk(key)] }), { status: 200 });
    }
    if (url.pathname === "/token") {
      return new Response(
        JSON.stringify({
          resource_tokens: { [config.audience]: accessToken },
          refresh_token: "refresh-token",
        }),
        { status: 200 },
      );
    }
    return new Response("missing", { status: 404 });
  };
  let pageContainsCode = false;
  const identity = await startFleetRoboSignIn({
    config,
    store,
    fetchImpl,
    now: () => now,
    openBrowser: async (authorizationUrl) => {
      const authorize = new URL(authorizationUrl);
      const redirect = authorize.searchParams.get("redirect_uri");
      const state = authorize.searchParams.get("state");
      if (redirect === null || state === null) return false;
      const response = await fetch(`${redirect}?code=synthetic-code&state=${encodeURIComponent(state)}`);
      pageContainsCode = (await response.text()).includes("synthetic-code");
      return response.status === 200;
    },
  });
  expect(pageContainsCode).toBe(false);
  expect(identity.subject).toBe("robo:abcdefghijklmnop");
  expect(currentFleetIdentity(now)?.subject).toBe("robo:abcdefghijklmnop");
  expect(store.saved.has("fleet-robo-access")).toBe(true);
  expect(store.saved.has("fleet-robo-refresh")).toBe(true);
});

it("keeps an existing verified identity when the browser does not open", async () => {
  const now = 1_800_000_000_000;
  rememberVerifiedFleetIdentity({
    subject: "robo:alreadyverified01",
    audience: config.audience,
    expiresAtMs: now + 60_000,
  });
  const store = memoryStore();
  await expect(
    startFleetRoboSignIn({
      config,
      store,
      now: () => now,
      openBrowser: async () => false,
    }),
  ).rejects.toThrow("Could not open your sign-in browser.");
  expect(currentFleetIdentity(now)?.subject).toBe("robo:alreadyverified01");
  expect(store.saved.size).toBe(0);
});

it("does not store a token when the callback does not match", async () => {
  const store = memoryStore();
  await expect(
    startFleetRoboSignIn({
      config,
      store,
      timeoutMs: 200,
      openBrowser: async (authorizationUrl) => {
        const redirect = new URL(authorizationUrl).searchParams.get("redirect_uri");
        if (redirect === null) return false;
        const response = await fetch(`${redirect}?code=synthetic-code&state=wrong`);
        expect(response.status).toBe(400);
        expect(await response.text()).not.toContain("synthetic-code");
        return true;
      },
    }),
  ).rejects.toThrow("Sign-in expired. Try again.");
  expect(store.saved.size).toBe(0);
  expect(currentFleetIdentity(0)).toBeNull();
});
