/** Isolated OAuth PKCE prototype. No login is started until the caller opens the URL. */
export async function prepareRoboDesktopAuth(input: {
  issuer: string;
  clientId: string;
  audience: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
  cryptoImpl?: Crypto;
}) {
  const issuer = new URL(input.issuer);
  const audience = new URL(input.audience);
  const redirect = new URL(input.redirectUri);
  if (
    issuer.protocol !== "https:" ||
    issuer.origin !== input.issuer ||
    audience.protocol !== "https:" ||
    audience.origin !== input.audience ||
    redirect.protocol !== "http:" ||
    !["127.0.0.1", "[::1]"].includes(redirect.hostname) ||
    redirect.pathname !== "/native/t3" ||
    redirect.username ||
    redirect.password ||
    redirect.search ||
    redirect.hash ||
    !redirect.port ||
    Number(redirect.port) < 1024 ||
    Number(redirect.port) > 65535 ||
    !input.clientId
  ) {
    throw new Error("Invalid desktop authorization configuration.");
  }
  const cryptoImpl = input.cryptoImpl ?? globalThis.crypto;
  const base64url = (bytes: Uint8Array) =>
    btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  const random = (length: number) => base64url(cryptoImpl.getRandomValues(new Uint8Array(length)));
  const verifier = random(48);
  const state = random(32);
  const challenge = base64url(
    new Uint8Array(await cryptoImpl.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
  );
  const authorize = new URL("/authorize", issuer);
  authorize.search = new URLSearchParams({
    response_type: "code",
    client_id: input.clientId,
    redirect_uri: redirect.href,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    resource: audience.origin,
  }).toString();
  let used = false;
  const parseCallback = (callbackUrl: string): URL | null => {
    let callback: URL;
    try {
      callback = new URL(callbackUrl);
    } catch {
      return null;
    }
    if (
      callback.origin !== redirect.origin ||
      callback.pathname !== redirect.pathname ||
      callback.hash ||
      callback.username ||
      callback.password ||
      callback.searchParams.has("error") ||
      callback.searchParams.getAll("state").length !== 1 ||
      callback.searchParams.get("state") !== state ||
      callback.searchParams.getAll("code").length !== 1 ||
      !callback.searchParams.get("code")
    )
      return null;
    return callback;
  };
  return {
    authorizationUrl: authorize.href,
    matchesCallback: (callbackUrl: string): boolean => !used && parseCallback(callbackUrl) !== null,
    async complete(
      callbackUrl: string,
      signal?: AbortSignal,
    ): Promise<{ accessToken: string; refreshToken: string | null }> {
      if (used) throw new Error("Authorization has already been completed.");
      const callback = parseCallback(callbackUrl);
      if (callback === null) throw new Error("Invalid authorization callback.");
      used = true;
      const response = await (input.fetchImpl ?? fetch)(new URL("/token", issuer), {
        method: "POST",
        redirect: "error",
        ...(signal ? { signal } : {}),
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: input.clientId,
          redirect_uri: redirect.href,
          code: callback.searchParams.get("code")!,
          code_verifier: verifier,
        }),
      });
      if (!response.ok) throw new Error("Authorization exchange failed.");
      const body: unknown = await response.json();
      if (
        typeof body !== "object" ||
        body === null ||
        !("resource_tokens" in body) ||
        typeof body.resource_tokens !== "object" ||
        body.resource_tokens === null ||
        !(audience.origin in body.resource_tokens)
      )
        throw new Error("Authorization response is invalid.");
      const token = (body.resource_tokens as Record<string, unknown>)[audience.origin];
      if (typeof token !== "string" || !token)
        throw new Error("Authorization response is invalid.");
      const refresh = "refresh_token" in body ? body.refresh_token : null;
      if (refresh !== null && (typeof refresh !== "string" || !refresh))
        throw new Error("Authorization response is invalid.");
      return { accessToken: token, refreshToken: refresh };
    },
  };
}
