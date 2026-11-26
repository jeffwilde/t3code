import { createElement } from "react";
import { act, render, stubGlobal } from "../../../test/render";
import { expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";
import { DesktopAppActivationBroker } from "../../../../desktop/src/app/DesktopAppActivationBroker.ts";

const state = vi.hoisted(() => ({
  ready: false,
  open: vi.fn(),
  pair: vi.fn(),
  catalog: { isReady: true, entries: new Map() },
}));
vi.mock("../../hooks/useOpenLocalWorkspace", () => ({
  useOpenLocalWorkspace: () => ({ ready: state.ready, open: state.open }),
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => state.catalog }));
vi.mock("../../connection/catalog", () => ({ environmentCatalog: { catalogValueAtom: {} } }));
vi.mock("../../connection/onboarding", () => ({ connectPairing: {} }));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => state.pair }));
vi.mock("../../rpc/atomRegistry", () => ({ appAtomRegistry: { get: () => state.catalog } }));
vi.mock("@t3tools/shared/fleetTopology", () => ({ permitsFleetTarget: () => true }));

import { DesktopAppActivationCoordinator } from "./DesktopAppActivationCoordinator";

it("keeps workspace queued through catalog hydration until its snapshot is ready", async () => {
  const broker = new DesktopAppActivationBroker({ requestTimeoutMs: 1000, activate: () => {} });
  let listener: ((request: never) => void) | undefined;
  const bridge = {
    appActivation: {
      onRequest: (fn: (request: never) => void) => {
        listener = fn;
        return () => {
          listener = undefined;
        };
      },
      setReady: async (value: boolean | { ready: boolean; workspaceReady: boolean }) => {
        const ready = typeof value === "boolean" ? value : value.ready;
        if (!ready) broker.clearRenderer();
        else
          broker.registerRenderer(
            (request) => listener?.(request as never),
            typeof value === "boolean" ? value : value.workspaceReady,
          );
      },
      complete: async (response: never) => {
        broker.complete(response);
      },
    },
  };
  using _desktopBridge = stubGlobal("desktopBridge", bridge);
  state.ready = false;
  state.open.mockResolvedValue({
    version: 1,
    requestId: "workspace",
    ok: false,
    code: "environment-unavailable",
    message: "test",
  });
  await using screen = await render(createElement(DesktopAppActivationCoordinator), {
    router: false,
  });
  try {
    const workspace = broker.request({
      version: 1,
      requestId: "workspace",
      type: "open-workspace",
      workspaceRoot: "/tmp/test",
      platform: "darwin",
    });
    expect(state.open).not.toHaveBeenCalled();
    const fleet = broker.request({
      version: 1,
      requestId: "fleet",
      type: "fleet-pair",
      environmentId: EnvironmentId.make("env"),
      origin: "https://host.example",
    });
    await act(async () => {
      await expect(fleet).resolves.toMatchObject({ ok: true, result: "absent" });
    });
    expect(state.open).not.toHaveBeenCalled();
    state.ready = true;
    await screen.rerender(createElement(DesktopAppActivationCoordinator));
    await act(async () => {
      await workspace;
    });
    expect(state.open).toHaveBeenCalledOnce();
  } finally {
    broker.close();
  }
});
