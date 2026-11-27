import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";

import { desktopDir, resolveElectronLaunchCommand } from "./electron-launcher.mjs";

NodeChildProcess.execFileSync(
  process.execPath,
  [NodePath.join(desktopDir, "scripts/build-browser-secret.mjs")],
  { stdio: "inherit" },
);
NodeChildProcess.execFileSync(
  process.execPath,
  [NodePath.join(desktopDir, "scripts/build-apple-speech.mjs")],
  { stdio: "inherit" },
);

const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;
// The launcher signs before spawn. The running app does not need the signing key.
delete childEnv.T3CODE_FLEET_CODESIGN_IDENTITY;
delete childEnv.T3CODE_FLEET_CODESIGN_KEYCHAIN;
delete childEnv.T3CODE_FLEET_CODESIGN_PASSWORD_FILE;

const electronCommand = resolveElectronLaunchCommand(["dist-electron/main.cjs"]);
const child = NodeChildProcess.spawn(electronCommand.electronPath, electronCommand.args, {
  stdio: "inherit",
  cwd: desktopDir,
  env: childEnv,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
