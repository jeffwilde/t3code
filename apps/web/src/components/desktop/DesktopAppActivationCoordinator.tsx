import type { DesktopAppActivationRequest } from "@t3tools/contracts";
import { useEffect, useEffectEvent, useRef } from "react";

import { useOpenLocalWorkspace } from "../../hooks/useOpenLocalWorkspace";
import { useAtomValue } from "@effect/atom-react";
import { environmentCatalog } from "../../connection/catalog";
import { connectPairing } from "../../connection/onboarding";
import { planFleetConnection } from "../../fleetConnection";
import { useAtomCommand } from "../../state/use-atom-command";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { permitsFleetTarget } from "@t3tools/shared/fleetTopology";
import { msg } from "gt-react";
import { m } from "../../i18n/messages";

export function DesktopAppActivationCoordinator() {
  const openLocalWorkspace = useOpenLocalWorkspace();
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  const pair = useAtomCommand(connectPairing, { reportFailure: false, reportDefect: false });
  const queueRef = useRef(Promise.resolve());
  const subscribedRef = useRef(false);
  const activation = window.desktopBridge?.appActivation;
  const ready = activation !== undefined && catalog.isReady;

  const processRequest = useEffectEvent(async (request: DesktopAppActivationRequest) => {
    if (request.type === "open-workspace") return openLocalWorkspace.open(request);
    if (!permitsFleetTarget(request.environmentId, request.origin))
      return {
        version: 1 as const,
        requestId: request.requestId,
        ok: false as const,
        code: "invalid-request" as const,
        message: m(msg("The fleet target is not authorized.")),
      };
    const plan = planFleetConnection({
      entries: appAtomRegistry.get(environmentCatalog.catalogValueAtom).entries,
      environmentId: request.environmentId,
      origin: request.origin,
    });
    if (plan === "conflict")
      return {
        version: 1 as const,
        requestId: request.requestId,
        ok: false as const,
        code: "invalid-request" as const,
        message: m(msg("The requested fleet route conflicts with a saved connection.")),
      };
    if (plan === "present" || request.pairingCode === undefined)
      return {
        version: 1 as const,
        requestId: request.requestId,
        ok: true as const,
        environmentId: request.environmentId,
        result: plan === "present" ? ("saved" as const) : ("absent" as const),
      };
    const result = await pair({
      host: request.origin,
      pairingCode: request.pairingCode,
      expectedEnvironmentId: request.environmentId,
    });
    return result._tag === "Success"
      ? {
          version: 1 as const,
          requestId: request.requestId,
          ok: true as const,
          environmentId: request.environmentId,
          result: "paired" as const,
        }
      : {
          version: 1 as const,
          requestId: request.requestId,
          ok: false as const,
          code: "environment-unavailable" as const,
          message: m(msg("Fleet pairing failed.")),
        };
  });

  const announceReadiness = useEffectEvent(() => {
    if (activation !== undefined) {
      void activation
        .setReady({ ready: true, workspaceReady: openLocalWorkspace.ready })
        .catch(() => undefined);
    }
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to desktop activation requests over the bridge and marks the renderer ready
  useEffect(() => {
    if (!ready || activation === undefined) return;

    let subscribed = true;
    const unsubscribe = activation.onRequest((request) => {
      queueRef.current = queueRef.current.then(async () => {
        const response = await processRequest(request);
        await activation.complete(response);
      });
      queueRef.current = queueRef.current.catch(() => undefined);
    });
    // Skip readiness if React runs cleanup before this subscription can receive requests.
    queueMicrotask(() => {
      if (subscribed) {
        subscribedRef.current = true;
        announceReadiness();
      }
    });
    return () => {
      subscribed = false;
      subscribedRef.current = false;
      void activation.setReady(false).catch(() => undefined);
      unsubscribe();
    };
  }, [activation, ready]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- updates the native broker when the workspace snapshot becomes available
  useEffect(() => {
    if (subscribedRef.current && activation !== undefined) {
      void activation
        .setReady({ ready: true, workspaceReady: openLocalWorkspace.ready })
        .catch(() => undefined);
    }
  }, [activation, openLocalWorkspace.ready]);

  return null;
}
