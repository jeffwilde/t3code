import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  type DesktopAppActivationRequest,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { DesktopAppActivationBroker } from "./DesktopAppActivationBroker.ts";

const request: DesktopAppActivationRequest = {
  version: 1,
  requestId: "request-1",
  type: "open-workspace",
  workspaceRoot: "/workspace/project",
  platform: "linux",
};

describe("DesktopAppActivationBroker", () => {
  it("lets fleet status proceed while a workspace waits for its snapshot", async () => {
    const send = vi.fn();
    const broker = new DesktopAppActivationBroker({ requestTimeoutMs: 1_000, activate: vi.fn() });
    broker.registerRenderer(send, false);
    const workspace = broker.request(request);
    expect(send).not.toHaveBeenCalled();
    const fleet = broker.request({
      version: 1,
      requestId: "fleet-delayed",
      type: "fleet-pair",
      environmentId: EnvironmentId.make("env"),
      origin: "https://host.example",
    });
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0].type).toBe("fleet-pair");
    broker.complete({
      version: 1,
      requestId: "fleet-delayed",
      ok: true,
      environmentId: EnvironmentId.make("env"),
      result: "absent",
    });
    await fleet;
    expect(send).toHaveBeenCalledOnce();
    broker.registerRenderer(send, true);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[0].type).toBe("open-workspace");
    broker.complete({
      version: 1,
      requestId: request.requestId,
      ok: true,
      projectId: ProjectId.make("project-1"),
      threadId: ThreadId.make("thread-1"),
    });
    await workspace;
    broker.close();
  });
  it("does not focus the window for a fleet status request", async () => {
    const activate = vi.fn();
    const broker = new DesktopAppActivationBroker({ requestTimeoutMs: 1_000, activate });
    broker.registerRenderer(vi.fn());
    const response = broker.request({
      version: 1,
      requestId: "fleet",
      type: "fleet-pair",
      environmentId: EnvironmentId.make("env"),
      origin: "https://host.example",
    });
    expect(activate).not.toHaveBeenCalled();
    broker.complete({
      version: 1,
      requestId: "fleet",
      ok: true,
      environmentId: EnvironmentId.make("env"),
      result: "absent",
    });
    await expect(response).resolves.toMatchObject({ ok: true, result: "absent" });
    broker.close();
  });
  it("focuses immediately and waits for renderer readiness", async () => {
    const activate = vi.fn();
    const send = vi.fn();
    const broker = new DesktopAppActivationBroker({ requestTimeoutMs: 1_000, activate });

    const response = broker.request(request);
    expect(activate).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();

    broker.registerRenderer(send);
    expect(send).toHaveBeenCalledWith(request);
    broker.complete({
      version: 1,
      requestId: request.requestId,
      ok: true,
      projectId: ProjectId.make("project-1"),
      threadId: ThreadId.make("thread-1"),
    });

    await expect(response).resolves.toMatchObject({ ok: true, projectId: "project-1" });
    broker.close();
  });

  it("fails an in-flight request when the renderer goes away", async () => {
    const broker = new DesktopAppActivationBroker({ requestTimeoutMs: 1_000, activate: vi.fn() });
    broker.registerRenderer(vi.fn());

    const response = broker.request(request);
    broker.clearRenderer();

    await expect(response).resolves.toMatchObject({
      ok: false,
      code: "renderer-unavailable",
    });
    broker.close();
  });

  it("never sends a canceled request that was queued behind another request", async () => {
    const send = vi.fn();
    const broker = new DesktopAppActivationBroker({ requestTimeoutMs: 1_000, activate: vi.fn() });
    broker.registerRenderer(send);
    const secondRequest = { ...request, requestId: "request-2" };

    const firstResponse = broker.request(request);
    const secondResponse = broker.request(secondRequest);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith(request);

    broker.cancel(secondRequest.requestId);
    broker.complete({
      version: 1,
      requestId: request.requestId,
      ok: true,
      projectId: ProjectId.make("project-1"),
      threadId: ThreadId.make("thread-1"),
    });

    await expect(firstResponse).resolves.toMatchObject({ ok: true });
    await expect(secondResponse).resolves.toMatchObject({ ok: false });
    expect(send).toHaveBeenCalledTimes(1);
    broker.close();
  });
});
