import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { generateSigningKey, publicJwk, signAccessToken } from './testJwtFixture.mjs';
import { verifyRoboIdentity } from './verifyRobo.mjs';

const key = await generateSigningKey('synthetic');
const nowMs = 2_000_000;
const issuer = 'https://auth.example';
const audience = 'https://fleet.example';
const sub = `google:${'a'.repeat(64)}`;
const fetchJwks = async url => {
  assert.equal(url, `${issuer}/jwks.json`);
  return Response.json({ keys: [publicJwk(key)] });
};
const sign = changes => signAccessToken({ iss: issuer, aud: audience, sub, nbf: 1900, exp: 2100, ...changes }, key);
const verify = async (token, overrides = {}) => verifyRoboIdentity({ token, issuer, audience, fetchJwks, now: () => nowMs, ...overrides });

test('verifies an actual Robo-format ES256 token against fixed issuer keys and audience', async () => {
  assert.deepEqual(await verify(await sign({})), { subject: sub, audience, expiresAtMs: 2_100_000 });
});
test('rejects altered signature, incorrect claims, expired token and untrusted keys', async () => {
  const token = await sign({});
  const parts = token.split('.');
  const payload = Buffer.from(JSON.stringify({ iss: issuer, aud: audience, sub: `google:${'b'.repeat(64)}`, nbf: 1900, exp: 2100 })).toString('base64url');
  await assert.rejects(verify(`${parts[0]}.${payload}.${parts[2]}`));
  for (const changes of [{ iss: 'https://evil.example' }, { aud: 'https://evil.example' }, { exp: 2000 }, { sub: 'robo-test:alpha' }, { nbf: 2200 }]) await assert.rejects(verify(await sign(changes)));
  const other = await generateSigningKey('other');
  await assert.rejects(verify(token, { fetchJwks: async () => Response.json({ keys: [publicJwk(other)] }) }));
});
test('rejects bad issuer, key endpoint and redirect without authorizing', async () => {
  const token = await sign({});
  await assert.rejects(verify(token, { issuer: 'http://auth.example' }));
  await assert.rejects(verify(token, { fetchJwks: async () => new Response('broken') }));
  await assert.rejects(verify(token, { fetchJwks: async () => ({ ok: true, redirected: true }) }));
});

test('test subject requires explicit exact test issuer and audience', async () => {
  const testIssuer = 'https://auth-test.robo.ai', testAudience = 'https://t3-test.robo.ai';
  const testToken = await sign({ iss: testIssuer, aud: testAudience, sub: 'robo-test:alpha' });
  const fetchTestKeys = async () => Response.json({ keys: [publicJwk(key)] });
  await assert.rejects(verify(testToken, { issuer: testIssuer, audience: testAudience, fetchJwks: fetchTestKeys }));
  assert.equal((await verify(testToken, { issuer: testIssuer, audience: testAudience, fetchJwks: fetchTestKeys, allowSyntheticTestSubject: true })).subject, 'robo-test:alpha');
  await assert.rejects(verify(await sign({ sub: 'robo-test:alpha' }), { allowSyntheticTestSubject: true }));
});
