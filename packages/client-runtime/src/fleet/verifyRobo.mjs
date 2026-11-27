// Independent WebCrypto verification of compact ES256 JWTs.
const decode = part => {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) throw new Error('Invalid Robo token');
  const bytes = Buffer.from(part, 'base64url');
  if (bytes.toString('base64url') !== part) throw new Error('Invalid Robo token');
  return bytes;
};
const json = part => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decode(part)));
async function verifyJwt(token, issuer, audience, keys) {
  if (typeof token !== 'string' || token.length > 4096) throw new Error('Invalid Robo token');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid Robo token');
  const header = json(parts[0]), claims = json(parts[1]);
  if (header?.alg !== 'ES256' || header.typ !== 'at+jwt' || typeof header.kid !== 'string' || !header.kid || header.crit !== undefined) throw new Error('Invalid Robo token');
  const matches = keys.filter(k => k?.kid === header.kid && k.kty === 'EC' && k.crv === 'P-256' && (!k.use || k.use === 'sig') && (!k.alg || k.alg === 'ES256'));
  if (matches.length !== 1 || decode(parts[2]).length !== 64) throw new Error('Invalid Robo token');
  const key = await crypto.subtle.importKey('jwk', matches[0], { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  if (!await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, decode(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`))) throw new Error('Invalid Robo token');
  if (claims?.iss !== issuer || claims.aud !== audience || !Number.isSafeInteger(claims.exp) || !Number.isSafeInteger(claims.nbf)) throw new Error('Invalid Robo token');
  return claims;
}

/** Identity only: callers must separately check live fleet membership and device enrollment. */
export async function verifyRoboIdentity({ token, issuer, audience, fetchJwks, now = Date.now, allowSyntheticTestSubject = false }) {
  const origin = value => {
    try { const u = new URL(value); return u.protocol === 'https:' && u.origin === value && !u.username && !u.password; }
    catch { return false; }
  };
  if (!origin(issuer) || !origin(audience) || typeof now !== 'function') throw new Error('Invalid Robo trust configuration');
  // The deployment supplies a fixed issuer-bound fetch implementation, including
  // the service binding where Cloudflare same-zone routing requires it. Never
  // derive a URL, key set or trust boundary from token claims.
  const response = await fetchJwks(`${issuer}/jwks.json`);
  if (!response.ok || response.redirected) throw new Error('Robo signing keys unavailable');
  if (!response.body) throw new Error('Robo signing keys unavailable');
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 32_768) throw new Error('Robo signing keys unavailable');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let jwks;
  try { jwks = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error('Robo signing keys unavailable'); }
  if (!Array.isArray(jwks?.keys) || jwks.keys.length < 1 || jwks.keys.length > 16) throw new Error('Robo signing keys unavailable');
  const claims = await verifyJwt(token, issuer, audience, jwks.keys);
  const nowMs = now();
  if (!Number.isSafeInteger(nowMs) || claims.nbf * 1000 > nowMs + 60_000) throw new Error('Robo identity is not eligible');
  // Expiration is strict; only not-before permits bounded clock skew.
  const normalSubject = typeof claims.sub === 'string' && /^(?:google:[a-f0-9]{64}|robo:[A-Za-z0-9_-]{16,64})$/.test(claims.sub);
  const explicitTestSubject = allowSyntheticTestSubject === true && issuer === 'https://auth-test.robo.ai' && audience === 'https://t3-test.robo.ai' && typeof claims.sub === 'string' && /^robo-test:[A-Za-z0-9_-]{1,64}$/.test(claims.sub);
  if ((!normalSubject && !explicitTestSubject) || claims.exp * 1000 <= nowMs) throw new Error('Robo identity is not eligible');
  return { subject: claims.sub, audience, expiresAtMs: claims.exp * 1000 };
}
