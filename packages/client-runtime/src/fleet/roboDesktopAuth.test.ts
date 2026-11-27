import { describe, expect, it } from "vite-plus/test";
import { prepareRoboDesktopAuth } from "./roboDesktopAuth.ts";

const config = {
  issuer: "https://auth-test.robo.ai",
  clientId: "t3-test-desktop",
  audience: "https://t3-test.robo.ai",
  redirectUri: "http://127.0.0.1:49152/native/t3",
};

describe("isolated Robo desktop authorization", () => {
  it("validates state and PKCE, exchanges once, and selects the exact audience", async () => {
    let exchanges = 0;
    let expectedChallenge = "";
    const auth = await prepareRoboDesktopAuth({
      ...config,
      fetchImpl: async (url, init) => {
        exchanges++;
        expect(String(url)).toBe("https://auth-test.robo.ai/token");
        const form = new URLSearchParams(String(init?.body));
        expect(form.get("client_id")).toBe(config.clientId);
        expect(form.get("redirect_uri")).toBe(config.redirectUri);
        expect(form.get("code")).toBe("synthetic-code");
        const digest = new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(form.get("code_verifier")!),
          ),
        );
        expect(
          btoa(String.fromCharCode(...digest))
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/g, ""),
        ).toBe(expectedChallenge);
        return Response.json({
          resource_tokens: { [config.audience]: "synthetic-access" },
          refresh_token: "synthetic-refresh",
        });
      },
    });
    const authorize = new URL(auth.authorizationUrl);
    expectedChallenge = authorize.searchParams.get("code_challenge")!;
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorize.searchParams.get("resource")).toBe(config.audience);
    const state = authorize.searchParams.get("state")!;
    await expect(
      auth.complete(`${config.redirectUri}?code=synthetic-code&state=wrong`),
    ).rejects.toThrow("Invalid authorization callback");
    expect(exchanges).toBe(0);
    expect(await auth.complete(`${config.redirectUri}?code=synthetic-code&state=${state}`)).toEqual(
      { accessToken: "synthetic-access", refreshToken: "synthetic-refresh" },
    );
    await expect(
      auth.complete(`${config.redirectUri}?code=synthetic-code&state=${state}`),
    ).rejects.toThrow("already been completed");
    expect(exchanges).toBe(1);
  });
  it("rejects non-loopback and unregistered callback paths", async () => {
    await expect(
      prepareRoboDesktopAuth({ ...config, redirectUri: "http://localhost:49152/native/t3" }),
    ).rejects.toThrow();
    await expect(
      prepareRoboDesktopAuth({ ...config, redirectUri: "http://127.0.0.1:49152/native/other" }),
    ).rejects.toThrow();
  });
});
