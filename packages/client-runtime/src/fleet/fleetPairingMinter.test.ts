import * as NodeCrypto from "node:crypto";

import { expect, it } from "vite-plus/test";

import { generateSigningKey, publicJwk, signAccessToken } from "./testJwtFixture.mjs";
import { createFleetPairingMinter, issueVerifiedFleetPairingCode } from "./fleetPairingMinter.ts";

const issuer = "https://auth-test.robo.ai";
const audience = "https://t3-test.robo.ai";
const subject = "robo:abcdefghijklmnop";

it("redeems one verified code and keeps only its hash", async () => {
  const key = await generateSigningKey("pairing-key");
  const nowMs = 1_800_000_000_000;
  const token = await signAccessToken(
    {
      iss: issuer,
      aud: audience,
      sub: subject,
      nbf: Math.floor(nowMs / 1000) - 10,
      exp: Math.floor(nowMs / 1000) + 600,
    },
    key,
  );
  const codes = ["a".repeat(32)];
  const minter = createFleetPairingMinter({
    ttlMs: 30_000,
    randomCode: () => codes.shift() ?? "b".repeat(32),
  });
  const issued = await issueVerifiedFleetPairingCode({
    token,
    issuer,
    audience,
    nowMs,
    minter,
    fetchJwks: async () => new Response(JSON.stringify({ keys: [publicJwk(key)] }), { status: 200 }),
  });
  expect(issued?.subject).toBe(subject);
  expect(issued?.code).toBe("a".repeat(32));
  const digest = NodeCrypto.createHash("sha256").update(issued?.code ?? "").digest("hex");
  expect(JSON.stringify(minter)).not.toContain(issued?.code);
  expect(digest).not.toBe(issued?.code);
  expect(minter.redeem({ code: issued?.code ?? "", subject, nowMs: nowMs + 1_000 })).toBe(true);
  expect(minter.redeem({ code: issued?.code ?? "", subject, nowMs: nowMs + 1_000 })).toBe(false);
});

it("does not issue a code for a token the issuer rejects", async () => {
  const minter = createFleetPairingMinter({ ttlMs: 30_000, randomCode: () => "c".repeat(32) });
  const issued = await issueVerifiedFleetPairingCode({
    token: "not-a-token",
    issuer,
    audience,
    nowMs: 1_800_000_000_000,
    minter,
    fetchJwks: async () => new Response(JSON.stringify({ keys: [] }), { status: 200 }),
  });
  expect(issued).toBeNull();
  expect(minter.redeem({ code: "c".repeat(32), subject, nowMs: 1_800_000_000_000 })).toBe(false);
});