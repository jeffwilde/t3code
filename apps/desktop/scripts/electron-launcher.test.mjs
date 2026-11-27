import * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeVM from "node:vm";

import { assert, describe, it } from "vite-plus/test";

import {
  fleetKeychainLaunchArgs,
  makeDevelopmentEnvironmentScript,
  makeDevelopmentLauncherScript,
  resolveElectronBinaryPath,
  resolveLauncherIdentity,
  resolveMacCodeSignArguments,
  resolveMacLauncherPaths,
  writeDevelopmentLauncherScript,
} from "./electron-launcher.mjs";

describe("electron development launcher", () => {
  it("uses captured values only as fallbacks for a live runner environment", () => {
    const environmentScript = makeDevelopmentEnvironmentScript({
      VITE_DEV_SERVER_URL: "http://127.0.0.1:8526",
      T3CODE_PORT: "16566",
      T3CODE_HOME: "/tmp/t3",
      T3CODE_OTLP_PROTOCOL: "http/protobuf",
    });

    assert.include(
      environmentScript,
      "if [ -z \"${VITE_DEV_SERVER_URL:-}\" ]; then export VITE_DEV_SERVER_URL='http://127.0.0.1:8526'; fi",
    );
    assert.include(
      environmentScript,
      "if [ -z \"${T3CODE_OTLP_PROTOCOL:-}\" ]; then export T3CODE_OTLP_PROTOCOL='http/protobuf'; fi",
    );
    assert.notInclude(environmentScript, "\nexport VITE_DEV_SERVER_URL=");
  });

  it("keeps the launcher script free of volatile environment values", () => {
    const script = makeDevelopmentLauncherScript({
      electronBinaryPath: "/repo/node_modules/electron/Electron",
      mainEntryPath: "/repo/apps/desktop/dist-electron/main.cjs",
      desktopRoot: "/repo/apps/desktop",
      environmentFilePath: "/repo/apps/desktop/.electron-runtime/dev-environment.sh",
    });

    assert.include(
      script,
      "if [ -f '/repo/apps/desktop/.electron-runtime/dev-environment.sh' ]; then . '/repo/apps/desktop/.electron-runtime/dev-environment.sh'; fi",
    );
    assert.notInclude(script, "VITE_DEV_SERVER_URL");
    assert.include(
      script,
      "exec '/repo/node_modules/electron/Electron' --t3code-dev-root='/repo/apps/desktop' '/repo/apps/desktop/dist-electron/main.cjs' \"$@\"",
    );
    assert.notInclude(script, "--use-mock-keychain");
  });

  it("keeps the mock keychain off a real fleet launch and ahead of the entry for a synthetic one", () => {
    const script = makeDevelopmentLauncherScript({
      electronBinaryPath: "/repo/node_modules/electron/Electron",
      mainEntryPath: "/repo/apps/desktop/dist-electron/main.cjs",
      desktopRoot: "/repo/apps/desktop",
      environmentFilePath: "/repo/apps/desktop/.electron-runtime/dev-environment.sh",
      isolateKeychain: true,
    });

    assert.include(
      script,
      "exec '/repo/node_modules/electron/Electron' --use-mock-keychain --t3code-dev-root='/repo/apps/desktop' '/repo/apps/desktop/dist-electron/main.cjs' \"$@\"",
    );
    assert.deepEqual(fleetKeychainLaunchArgs({ T3CODE_FLEET_NO_CLOUD: "1" }, "darwin"), []);
    assert.deepEqual(
      fleetKeychainLaunchArgs(
        { T3CODE_FLEET_NO_CLOUD: "1", T3CODE_FLEET_SYNTHETIC_KEYCHAIN: "1" },
        "darwin",
      ),
      ["--use-mock-keychain"],
    );
    assert.deepEqual(
      fleetKeychainLaunchArgs({ T3CODE_FLEET_SYNTHETIC_KEYCHAIN: "1" }, "linux"),
      [],
    );
    assert.deepEqual(fleetKeychainLaunchArgs({}, "darwin"), []);
  });

  it("gives the fleet app its own bundle and refuses an ad-hoc signature", () => {
    assert.deepEqual(resolveLauncherIdentity({ T3CODE_FLEET_NO_CLOUD: "1" }, "repo"), {
      displayName: "T3 Code Fleet",
      bundleId: "ai.robo.t3code.fleet",
      protocolSchemes: ["t3code-fleet"],
    });
    assert.equal(resolveLauncherIdentity({}, "repo").bundleId, "com.t3tools.t3code");
    assert.equal(
      resolveLauncherIdentity({ VITE_DEV_SERVER_URL: "http://127.0.0.1:1" }, "repo").bundleId,
      "com.t3tools.t3code.dev.repo",
    );
    assert.throws(
      () => resolveMacCodeSignArguments("/tmp/T3 Code Fleet.app", { T3CODE_FLEET_NO_CLOUD: "1" }),
      /Refusing an ad-hoc signature/,
    );
    assert.deepEqual(
      resolveMacCodeSignArguments("/tmp/T3 Code Fleet.app", {
        T3CODE_FLEET_NO_CLOUD: "1",
        T3CODE_FLEET_CODESIGN_IDENTITY: "T3 Code Fleet Local Signing",
        T3CODE_FLEET_CODESIGN_KEYCHAIN: "/tmp/fleet.keychain-db",
      }).slice(0, 8),
      [
        "--force",
        "--sign",
        "T3 Code Fleet Local Signing",
        "--timestamp=none",
        "--options",
        "runtime",
        "--keychain",
        "/tmp/fleet.keychain-db",
      ],
    );
    assert.deepEqual(resolveMacCodeSignArguments("/tmp/T3 Code (Dev).app", {}), [
      "--force",
      "--deep",
      "--sign",
      "-",
      "--timestamp=none",
      "/tmp/T3 Code (Dev).app",
    ]);
  });

  it("repairs Electron before loading the package entrypoint", () => {
    const calls = [];
    const electronPath = resolveElectronBinaryPath({
      ensureRuntime: () => {
        calls.push("ensure");
      },
      createRequire: () => (specifier) => {
        calls.push(`require:${specifier}`);
        return "/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron";
      },
      moduleUrl: import.meta.url,
    });

    assert.equal(
      electronPath,
      "/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
    );
    assert.deepEqual(calls, ["ensure", "require:electron"]);
  });

  it("keeps the native Electron executable name inside the branded macOS bundle", () => {
    const paths = resolveMacLauncherPaths(
      "/repo/apps/desktop/.electron-runtime/T3 Code (Dev).app",
      "T3 Code (Dev)",
    );

    assert.equal(paths.launcherExecutableName, "T3 Code (Dev) Launcher");
    assert.equal(
      paths.launcherBinaryPath,
      "/repo/apps/desktop/.electron-runtime/T3 Code (Dev).app/Contents/MacOS/T3 Code (Dev) Launcher",
    );
    assert.equal(
      paths.runtimeElectronBinaryPath,
      "/repo/apps/desktop/.electron-runtime/T3 Code (Dev).app/Contents/MacOS/Electron",
    );

    const script = makeDevelopmentLauncherScript({
      electronBinaryPath: paths.runtimeElectronBinaryPath,
      mainEntryPath: "/repo/apps/desktop/dist-electron/main.cjs",
      desktopRoot: "/repo/apps/desktop",
      environmentFilePath: "/repo/apps/desktop/.electron-runtime/dev-environment.sh",
    });
    assert.include(
      script,
      "exec '/repo/apps/desktop/.electron-runtime/T3 Code (Dev).app/Contents/MacOS/Electron'",
    );
    assert.notInclude(script, "node_modules/electron");
  });

  it("restores execute permissions on an unchanged launcher", () => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-launcher-"));
    const launcherPath = NodePath.join(directory, "launcher");
    try {
      writeDevelopmentLauncherScript(launcherPath, "/runtime/Electron");
      NodeFS.chmodSync(launcherPath, 0o644);

      assert.isFalse(writeDevelopmentLauncherScript(launcherPath, "/runtime/Electron"));
      assert.equal(NodeFS.statSync(launcherPath).mode & 0o777, 0o755);
    } finally {
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
  });
});

// Supply inert imports so the real startup runs without launching Electron or signalling processes.
async function runDevElectronStartup({
  desktopDir = "/repo/apps/desktop",
  spawnSync,
  spawn,
  ...context
}) {
  const source = NodeFS.readFileSync(new URL("./dev-electron.mjs", import.meta.url), "utf8");
  await NodeVM.runInNewContext(
    `(async () => { ${source.replace(/^import\s[\s\S]*?;\n/gm, "")} })()`,
    {
      NodeChildProcess: {
        execFileSync: () => undefined,
        spawnSync: spawnSync ?? (() => undefined),
        spawn: spawn ?? (() => new NodeEvents.EventEmitter()),
      },
      NodeFS: { watch: () => ({ close: () => undefined }) },
      NodeOS: { platform: () => "linux" },
      NodePath,
      desktopDir,
      resolveDevProtocolClient: () => null,
      resolveElectronLaunchCommand: (args) => ({ electronPath: "electron", args }),
      waitForResources: async () => undefined,
      URL,
      ...makeFakeClock(),
      process: {
        env: { VITE_DEV_SERVER_URL: "http://localhost:1234" },
        execPath: "node",
        ppid: 1,
        once: () => undefined,
      },
      ...context,
    },
  );
}

async function startupCleanupPattern(desktopDir) {
  let pattern;
  await runDevElectronStartup({
    desktopDir,
    spawnSync: (command, args) => {
      if (command === "pkill" && args.includes("-f")) pattern = args.at(-1);
    },
  });
  assert.isString(pattern);
  return pattern;
}

function makeFakeClock() {
  let now = 0;
  let timers = [];
  const schedule = (callback, delay, repeat) => {
    const timer = { callback, due: now + (delay ?? 0), repeat: repeat ? (delay ?? 0) : null };
    timer.handle = { unref: () => timer.handle, ref: () => timer.handle };
    timers.push(timer);
    return timer.handle;
  };
  const clear = (handle) => {
    timers = timers.filter((timer) => timer.handle !== handle);
  };
  const flushMicrotasks = async () => {
    for (let index = 0; index < 50; index += 1) await Promise.resolve();
  };
  return {
    setTimeout: (callback, delay) => schedule(callback, delay, false),
    setInterval: (callback, delay) => schedule(callback, delay, true),
    clearTimeout: clear,
    clearInterval: clear,
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        await flushMicrotasks();
        const next = timers
          .filter((timer) => timer.due <= end)
          .toSorted((a, b) => a.due - b.due)[0];
        if (!next) break;
        now = next.due;
        if (next.repeat === null) clear(next.handle);
        else next.due = now + Math.max(next.repeat, 1);
        next.callback();
      }
      now = end;
      await flushMicrotasks();
    },
  };
}

it("dev supervisor stops Electron and exits once its parent process goes away", async () => {
  const clock = makeFakeClock();
  let ppid = 4242;
  const exitCodes = [];
  const appSignals = [];
  await runDevElectronStartup({
    ...clock,
    spawn: () => {
      const app = new NodeEvents.EventEmitter();
      app.pid = 5151;
      app.kill = (signal) => {
        appSignals.push(signal);
        app.emit("exit", null, signal);
      };
      return app;
    },
    process: {
      env: { VITE_DEV_SERVER_URL: "http://localhost:1234" },
      execPath: "node",
      pid: 4343,
      get ppid() {
        return ppid;
      },
      once: () => undefined,
      exit: (code) => {
        exitCodes.push(code);
      },
    },
  });

  await clock.advance(5_000);
  assert.deepEqual(appSignals, [], "supervisor stopped Electron while its parent was alive");

  // The launching process died without signalling us; the OS reparented the supervisor.
  ppid = 1;
  await clock.advance(5_000);

  assert.include(
    appSignals,
    "SIGTERM",
    "supervisor kept Electron running after its parent process went away",
  );
  assert.lengthOf(exitCodes, 1, "supervisor did not exit after its parent process went away");
});

it
  // oxlint-disable-next-line t3code/no-global-process-runtime -- Native pgrep is unavailable on Windows.
  .skipIf(NodeOS.platform() === "win32")
  .each([
    "/tmp/t3-feature.one/apps/desktop",
    "/tmp/t3-feature.one [two](three)+?^${four}|back\\slash*/apps/desktop",
  ])("dev cleanup matches only the literal root argument: %s", async (desktopDir) => {
  const pattern = await startupCleanupPattern(desktopDir);
  const flag = `--t3code-dev-root=${desktopDir}`;
  const argvCases = [
    [flag],
    [flag, "main.cjs"],
    [flag.replace(".one", "Xone")],
    [`${flag}-two`],
    [`prefix${flag}`],
    [`--t3code-dev-root=/other${desktopDir}`],
  ];
  const children = [];
  try {
    for (const args of argvCases) {
      const child = NodeChildProcess.spawn(
        process.execPath,
        ["-e", "process.send('ready'); setInterval(() => {}, 1000)", "--", ...args],
        { stdio: ["ignore", "ignore", "inherit", "ipc"] },
      );
      children.push(child);
      await Promise.race([
        NodeEvents.once(child, "message"),
        NodeEvents.once(child, "exit").then(() => {
          throw new Error("Fixture exited before readiness");
        }),
      ]);
    }
    // Use the native ERE engine, but never execute the launcher's signal-producing command.
    const result = NodeChildProcess.spawnSync(
      "pgrep",
      ["-P", String(process.pid), "-f", "--", pattern],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const matches = result.stdout.trim().split(/\s+/).map(Number);
    assert.sameMembers(
      matches,
      children.slice(0, 2).map((child) => child.pid),
    );
  } finally {
    await Promise.all(
      children.map(async (child) => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        const exited = NodeEvents.once(child, "exit");
        child.kill("SIGTERM");
        await exited;
      }),
    );
  }
});
