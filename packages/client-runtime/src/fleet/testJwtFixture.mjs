// Synthetic ES256 JWT generator for local tests; it does not handle real keys.
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
export async function generateSigningKey(kid) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return { ...await crypto.subtle.exportKey('jwk', pair.privateKey), kid };
}
export function publicJwk({ kty, crv, x, y, kid }) { return { kty, crv, x, y, kid }; }
export async function signAccessToken(claims, jwk) {
  const data = `${encode({ alg: 'ES256', typ: 'at+jwt', kid: jwk.kid })}.${encode(claims)}`;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(data));
  return `${data}.${Buffer.from(signature).toString('base64url')}`;
}
