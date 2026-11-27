// @effect-diagnostics nodeBuiltinImport:off globalTimers:off - User-initiated loopback uses a bounded Node listener.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import * as NodePath from "node:path";

import { prepareRoboDesktopAuth } from "@t3tools/client-runtime/fleet/robo-desktop-auth";
import { verifyRoboIdentity } from "@t3tools/client-runtime/fleet/verify-robo";
import { parseFleetRoboConfig, type FleetRoboConfig } from "@t3tools/shared/fleetRoboConfig";

import {
  clearVerifiedFleetIdentity,
  currentFleetIdentity,
  rememberVerifiedFleetIdentity,
  type VerifiedFleetIdentity,
} from "./fleetRoboSession.ts";

declare const __T3CODE_FLEET_ROBO__: string | undefined;

const ACCESS_SECRET = "fleet-robo-access";
const REFRESH_SECRET = "fleet-robo-refresh";

export interface FleetSecretStore {
  put(name: string, value: string): Promise<void>;
  get(name: string): Promise<string | null>;
}

/** Persist Robo tokens with Electron safeStorage. The plaintext is not written. */
export async function electronFleetSecretStore(stateDir: string): Promise<FleetSecretStore> {
  const { safeStorage } = await import("electron");
  const directory = NodePath.join(stateDir, "fleet-robo");
  return {
    async put(name, value) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure storage is unavailable.");
      await NodeFSP.mkdir(directory, { recursive: true, mode: 0o700 });
      const destination = NodePath.join(directory, name);
      const temporary = NodePath.join(directory, `${NodeCrypto.randomBytes(8).toString("hex")}.tmp`);
      await NodeFSP.writeFile(temporary, safeStorage.encryptString(value), { mode: 0o600 });
      await NodeFSP.rename(temporary, destination);
    },
    async get(name) {
      try {
        return safeStorage.decryptString(await NodeFSP.readFile(NodePath.join(directory, name)));
      } catch {
        return null;
      }
    },
  };
}

export function fleetRoboConfigFromBuild(): FleetRoboConfig | null {
  const raw = typeof __T3CODE_FLEET_ROBO__ === "undefined" ? "" : __T3CODE_FLEET_ROBO__;
  return parseFleetRoboConfig(raw);
}

function html(status: number, body: string, response: NodeHttp.ServerResponse): void {
  response.setHeader("cache-control", "no-store");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader(
    "content-security-policy",
    "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
  );
  response.writeHead(status, { "content-type": "text/html; charset=utf-8" }).end(body);
}

const RETURN_PAGE =
  '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>T3 Code</title></head><body><main><h1>Return to T3 Code</h1><p>Your sign-in response has been received. You can close this tab.</p></main></body></html>';

/**
 * Open the system browser for Robo PKCE. Nothing is stored until the token
 * verifies. Authorization URLs, codes, and tokens are not logged.
 */
export async function startFleetRoboSignIn(input: {
  readonly openBrowser: (url: string) => Promise<boolean>;
  readonly store: FleetSecretStore;
  readonly config?: FleetRoboConfig | null;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}): Promise<VerifiedFleetIdentity> {
  const config = input.config === undefined ? fleetRoboConfigFromBuild() : input.config;
  if (config === null) throw new Error("Fleet identity is not configured.");
  const now = input.now ?? Date.now;
  const previous = currentFleetIdentity(now());
  const pending = Promise.withResolvers<string>();
  void pending.promise.catch(() => undefined);
  let flow: Awaited<ReturnType<typeof prepareRoboDesktopAuth>> | null = null;
  let redirectUri = "";
  let accepted = false;
  const server = NodeHttp.createServer((request, response) => {
    if (flow === null || request.method !== "GET" || !request.url) {
      html(400, "This response does not belong to the active sign-in.", response);
      return;
    }
    const callback = new URL(request.url, redirectUri).href;
    if (accepted || !flow.matchesCallback(callback)) {
      html(400, "This response does not belong to the active sign-in.", response);
      return;
    }
    accepted = true;
    pending.resolve(callback);
    html(200, RETURN_PAGE, response);
  });
  const timer = setTimeout(
    () => pending.reject(new Error("Sign-in expired. Try again.")),
    input.timeoutMs ?? 300_000,
  );
  timer.unref?.();
  const onAbort = () => pending.reject(new Error("Sign-in cancelled on this computer."));
  input.signal?.addEventListener("abort", onAbort, { once: true });
  let stored = false;
  try {
    if (input.signal?.aborted) throw new Error("Sign-in cancelled on this computer.");
    await new Promise<void>((resolve, reject) => {
      server.once("error", () => reject(new Error("Could not open the local sign-in callback.")));
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Could not open the local sign-in callback.");
    }
    redirectUri = `http://127.0.0.1:${address.port}/native/t3`;
    flow = await prepareRoboDesktopAuth({
      issuer: config.issuer,
      clientId: config.clientId,
      audience: config.audience,
      redirectUri,
      ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
    });
    const opened = await input.openBrowser(flow.authorizationUrl);
    if (!opened) throw new Error("Could not open your sign-in browser.");
    const active = flow;
    const tokens = await active.complete(await pending.promise, input.signal);
    const issuer = config.issuer;
    const identity = await verifyRoboIdentity({
      token: tokens.accessToken,
      issuer,
      audience: config.audience,
      now,
      fetchJwks: async (url) => {
        if (url !== `${issuer}/jwks.json`) throw new Error("Robo signing keys unavailable");
        return (input.fetchImpl ?? fetch)(url);
      },
    });
    await input.store.put(ACCESS_SECRET, tokens.accessToken);
    if (tokens.refreshToken !== null) await input.store.put(REFRESH_SECRET, tokens.refreshToken);
    rememberVerifiedFleetIdentity(identity);
    stored = true;
    return identity;
  } catch (error) {
    if (!stored) {
      if (previous) rememberVerifiedFleetIdentity(previous);
      else clearVerifiedFleetIdentity();
    }
    throw error;
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", onAbort);
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
