#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";

const [command, account, ...args] = process.argv.slice(2);
const root = process.env.CODEX_ACCOUNTS_HOME || homedir();
const accent = (text) => process.stdout.isTTY && !process.env.NO_COLOR
  ? `\x1b[38;2;143;194;250m${text}\x1b[0m`
  : text;
const success = (text) => process.stdout.isTTY && !process.env.NO_COLOR
  ? `\x1b[38;2;166;227;161m${text}\x1b[0m`
  : text;
const pending = (text) => process.stdout.isTTY && !process.env.NO_COLOR
  ? `\x1b[38;2;220;171;255m${text}\x1b[0m`
  : text;
const emailColor = (text) => process.stdout.isTTY && !process.env.NO_COLOR
  ? `\x1b[38;2;246;226;183m${text}\x1b[0m`
  : text;
const muted = (text) => process.stdout.isTTY && !process.env.NO_COLOR
  ? `\x1b[38;2;171;171;171m${text}\x1b[0m`
  : text;

function usage(exitCode = 0) {
  console.log(`Usage:
  cma login <workspace> [codex login options]
  cma run <workspace> [codex options and prompt]
  cma status <workspace>
  cma migrate <workspace>
  cma dashboard

Examples:
  cma login personal
  cma login work --device-auth
  cma run personal
  cma run work "review this project"
  cma migrate personal
  cma

Each account gets isolated Codex credentials and state under:
  ${root}/.codex-<workspace>

The migrate command moves an existing default ${root}/.codex directory into
the chosen workspace, preserving its current Codex login.`);
  process.exitCode = exitCode;
}

function workspaceHome(name) {
  const workspace = name.trim();
  const reservedName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
  if (!workspace || workspace === "." || workspace === ".." || workspace.length > 100 || workspace.endsWith(".") || /[\\/:*?"<>|\x00-\x1F]/.test(workspace) || reservedName.test(workspace)) {
    console.error("Enter a valid workspace name, for example: personal, work, or 01");
    process.exit(1);
  }
  return join(root, `.codex-${workspace}`);
}

function runCodex(codexHome, codexArgs, stdio, input) {
  const env = codexHome ? { ...process.env, CODEX_HOME: codexHome } : { ...process.env };
  const options = { env, stdio };
  if (input !== undefined) options.input = input;
  return process.platform === "win32"
    ? spawnSync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$cmaArgs = ConvertFrom-Json $env:CMA_ARGS; if ($null -eq $cmaArgs) { & codex } else { & codex @cmaArgs }; exit $LASTEXITCODE"
    ], {
      env: { ...env, CMA_ARGS: JSON.stringify(codexArgs) },
      stdio,
      input
    })
    : spawnSync("codex", codexArgs, options);
}

function launch(codexHome, codexArgs) {
  if (codexArgs[0] === "login") {
    launchLogin(codexHome, codexArgs);
    return;
  }
  const result = runCodex(codexHome, codexArgs, "inherit");

  if (result.error) {
    console.error("Could not start Codex. Install it first, then ensure the `codex` command is on PATH.");
    process.exitCode = 1;
    return;
  }
  process.exitCode = result.status ?? 1;
}

function launchLogin(codexHome, codexArgs) {
  const env = { ...process.env, CODEX_HOME: codexHome };
  const child = process.platform === "win32"
    ? spawn("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$cmaArgs = ConvertFrom-Json $env:CMA_ARGS; & codex @cmaArgs; exit $LASTEXITCODE"
    ], {
      env: { ...env, CMA_ARGS: JSON.stringify(codexArgs) },
      stdio: ["inherit", "pipe", "inherit"]
    })
    : spawn("codex", codexArgs, { env, stdio: ["inherit", "pipe", "inherit"] });

  let pendingOutput = "";
  const printLine = (line) => {
    const plainLine = line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").trim();
    if (plainLine === "Successfully logged in") {
      console.log(`\n${success("Successfully logged in")}\n`);
    } else {
      process.stdout.write(line);
    }
  };

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    pendingOutput += chunk;
    let newline;
    while ((newline = pendingOutput.indexOf("\n")) !== -1) {
      printLine(pendingOutput.slice(0, newline + 1));
      pendingOutput = pendingOutput.slice(newline + 1);
    }
  });
  child.on("error", () => {
    console.error("Could not start Codex. Install it first, then ensure the `codex` command is on PATH.");
    process.exitCode = 1;
  });
  child.on("close", (code) => {
    if (pendingOutput) printLine(pendingOutput);
    process.exitCode = code ?? 1;
  });
}

function profiles() {
  const result = [];
  const defaultHome = join(root, ".codex");
  if (existsSync(defaultHome)) result.push({ folder: ".codex", home: defaultHome });
  if (!existsSync(root)) return result;

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith(".codex-") && entry.name.length > 7) {
      result.push({ folder: entry.name, home: join(root, entry.name) });
    }
  }
  return result.sort((a, b) => a.folder === ".codex" ? -1 : b.folder === ".codex" ? 1 : a.folder.localeCompare(b.folder));
}

function isSignedIn(profile) {
  const result = runCodex(profile.home, ["login", "status"], "pipe");
  return !result.error && result.status === 0;
}

function startCodexAppServer(codexHome) {
  const env = { ...process.env, CODEX_HOME: codexHome };
  const options = { env, stdio: ["pipe", "pipe", "ignore"] };
  if (process.platform === "win32") {
    return spawn("cmd.exe", ["/d", "/s", "/c", "codex app-server"], options);
  }
  return spawn("codex", ["app-server"], options);
}

function accountInfo(profile) {
  return new Promise((resolve) => {
    const process = startCodexAppServer(profile.home);
    let buffer = "";
    let settled = false;
    let timeout;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (!process.stdin.destroyed) process.stdin.end();
      resolve(value);
    };
    const fallback = () => finish({ signedIn: isSignedIn(profile), email: null });
    timeout = setTimeout(() => {
      process.kill();
      fallback();
    }, 10_000);
    const send = (message) => process.stdin.write(`${JSON.stringify(message)}\n`);

    process.on("error", fallback);
    process.stdin.on("error", () => {});
    process.on("close", () => {
      if (!settled) fallback();
    });
    process.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) {
        try {
          const response = JSON.parse(line);
          if (response.id === 0) {
            send({ method: "initialized", params: {} });
            send({ method: "account/read", id: 1, params: { refreshToken: false } });
          }
          if (response.id === 1) {
            finish({
              signedIn: Boolean(response.result?.account),
              email: typeof response.result?.account?.email === "string" ? response.result.account.email : null
            });
          }
        } catch {
          // Ignore non-JSON or unrelated app-server messages.
        }
      }
    });
    send({
      method: "initialize",
      id: 0,
      params: { clientInfo: { name: "codex_multiple_accounts", title: "Codex Multiple Accounts", version: "0.1.1" } }
    });
  });
}

async function startTui() {
  if (!process.stdin.isTTY) {
    console.error("The profile menu requires an interactive terminal. Use `cma --help` for command options.");
    process.exitCode = 1;
    return;
  }

  const ui = createInterface({ input: process.stdin, output: process.stdout });
  const cancelController = new AbortController();
  let cancelMessage = "Cancelled with Esc";
  const cancel = (message) => {
    cancelMessage = message;
    if (!cancelController.signal.aborted) cancelController.abort();
  };
  const onKeypress = (_character, key) => {
    if (key?.name === "escape") cancel("Cancelled with Esc");
  };
  const ask = (prompt) => ui.question(prompt, { signal: cancelController.signal });
  process.stdin.on("keypress", onKeypress);
  ui.on("SIGINT", () => cancel("Cancelled with Ctrl+C"));
  try {
    console.log(`\n${accent("Sign in to multiple Codex accounts")}\n`);
    const currentHome = process.env.CODEX_HOME || join(root, ".codex");
    console.log(accent("Workspaces"));
    const workspaces = await Promise.all(profiles().map(async (profile) => ({
      ...profile,
      ...await accountInfo(profile),
      current: profile.home.toLowerCase() === currentHome.toLowerCase()
    })));
    const folderWidth = Math.max(0, ...workspaces.map((profile) => profile.folder.length));
    const accountLabel = (profile) => profile.email || (profile.signedIn ? "Signed in" : "Not signed in");
    const accountWidth = Math.max(0, ...workspaces.map((profile) => accountLabel(profile).length));
    const workspaceState = (profile) => profile.signedIn
      ? success(profile.current ? "Connected & Current" : "Connected")
      : pending("Workspace created but need sign in");
    if (workspaces.length) {
      workspaces.forEach((profile) => {
        const marker = profile.current ? `${success("✓")} ` : "  ";
        const folderPadding = " ".repeat(folderWidth - profile.folder.length);
        const account = profile.email ? emailColor(profile.email) : muted(accountLabel(profile));
        const accountPadding = " ".repeat(accountWidth - accountLabel(profile).length);
        console.log(`  ${marker}${profile.folder}${folderPadding}    ${account}${accountPadding}    ${workspaceState(profile)}`);
      });
    } else {
      console.log("  No local workspaces found.");
    }

    console.log(`\n${accent("Options")}`);
    console.log(`  ${accent("1.")} Switch account`);
    console.log(`  ${accent("2.")} Sign in to a new or existing account`);
    console.log(`  ${accent("3.")} Migrate existing .codex to a workspace`);
    console.log(`  ${accent("4.")} Delete workspace`);
    console.log(`  ${accent("5.")} Back to terminal\n`);

    const choice = (await ask(`${accent("Choose (1-5):")} `)).trim();
    if (choice === "5" || choice === "") {
      console.log("");
      return;
    }
    if (choice === "1") {
      if (!workspaces.length) throw new Error("No workspaces found. Choose option 2 to sign in.");
      console.log(`\n${accent("Switch account")}`);
      workspaces.forEach((profile, index) => {
        console.log(`  ${accent(`${index + 1}.`)} ${profile.folder}`);
      });
      console.log("");
      const selectedChoice = (await ask(`${accent(`Choose (1-${workspaces.length}):`)} `)).trim();
      if (selectedChoice === "") return;
      const selected = workspaces[Number(selectedChoice) - 1];
      if (!selected) throw new Error("Choose one of the displayed numbers.");
      if (!selected.signedIn) throw new Error(`${selected.folder} is not signed in yet. Choose option 2 to sign in.`);
      launch(selected.home, []);
      return;
    }
    if (choice === "2") {
      console.log("");
      const workspace = (await ask(`${accent("Workspace name:")} `)).trim();
      console.log("");
      const newHome = workspaceHome(workspace);
      mkdirSync(newHome, { recursive: true });
      launch(newHome, ["login"]);
      return;
    }
    if (choice === "3") {
      console.log("");
      const workspace = (await ask(`${accent("Workspace name:")} `)).trim();
      const destination = workspaceHome(workspace);
      const existing = join(root, ".codex");
      if (!existsSync(existing)) throw new Error(`No existing default profile found at: ${existing}`);
      if (existsSync(destination)) throw new Error(`Profile already exists: ${destination}`);
      console.log(`\n${accent(`Move .codex to .codex-${workspace}?`)}`);
      const confirm = (await ask(`${accent("Type yes to confirm:")} `)).trim().toLowerCase();
      if (confirm === "yes") {
        renameSync(existing, destination);
        console.log(`Moved ${existing} to ${destination}`);
      } else {
        console.log("Nothing changed.");
      }
      return;
    }
    if (choice === "4") {
      if (!workspaces.length) throw new Error("No workspaces found to delete.");
      console.log(`\n${accent("Delete workspace")}`);
      workspaces.forEach((profile, index) => {
        console.log(`  ${accent(`${index + 1}.`)} ${workspaceLabel(profile)}`);
      });
      console.log("");
      const selectedChoice = (await ask(`${accent(`Choose (1-${workspaces.length}):`)} `)).trim();
      if (selectedChoice === "") return;
      const selected = workspaces[Number(selectedChoice) - 1];
      if (!selected) throw new Error("Choose one of the displayed numbers.");
      console.log(`\n${pending(`This permanently deletes ${selected.folder} and its local Codex data.`)}`);
      console.log("");
      const confirm = (await ask(`${accent(`Type ${selected.folder} to confirm:`)} `)).trim();
      if (confirm === selected.folder) {
        rmSync(selected.home, { recursive: true, force: false });
        console.log("");
        console.log(success(`Deleted ${selected.folder}.`));
        console.log("");
      } else {
        console.log("Nothing changed.");
      }
      return;
    }
    throw new Error("Choose one of the displayed numbers.");
  } catch (error) {
    if (error.name === "AbortError") {
      console.log(`\n${cancelMessage}\n`);
    } else {
      console.error(error.message);
      process.exitCode = 1;
    }
  } finally {
    process.stdin.removeListener("keypress", onKeypress);
    ui.close();
  }
}

if (["--help", "-h", "help"].includes(command)) {
  usage(0);
} else if (!command || command === "tui" || command === "dashboard") {
  await startTui();
} else {
  if (!account) {
    usage(1);
  } else {
    const codexHome = workspaceHome(account);
    let codexArgs;

    switch (command) {
  case "login":
    mkdirSync(codexHome, { recursive: true });
    codexArgs = ["login", ...args];
    break;
  case "run":
    mkdirSync(codexHome, { recursive: true });
    codexArgs = args;
    break;
  case "status":
    if (!existsSync(codexHome)) {
      console.error(`Workspace not found: ${codexHome}`);
      process.exit(1);
    }
    codexArgs = ["login", "status", ...args];
    break;
  case "migrate": {
    const existingHome = join(root, ".codex");
    if (existsSync(codexHome)) {
      console.error(`Profile already exists: ${codexHome}`);
      process.exit(1);
    }
    if (!existsSync(existingHome)) {
      console.error(`No existing default Codex profile found at: ${existingHome}`);
      process.exit(1);
    }
    renameSync(existingHome, codexHome);
    console.log(`Moved ${existingHome} to ${codexHome}`);
    process.exit(0);
  }
      default:
        console.error(`Unknown command: ${command}`);
        usage(1);
    }

    if (codexArgs) launch(codexHome, codexArgs);
  }
}
