# codex-x

Use multiple Codex CLI accounts on one computer without replacing the active login. Each workspace has its own `CODEX_HOME`, so Codex stores its credentials, configuration, and local history separately.

## Install

```sh
npm install -g codex-x
```

Codex CLI must already be installed and available as `codex` in your terminal.

## Interactive menu

Run `codex-x` with no arguments to open the terminal interface. It marks the current workspace with a checkmark and shows whether each local Codex folder is connected or still needs sign-in. For connected ChatGPT accounts, it also displays the email returned by Codex locally; it is not saved by Codex X. Choose `1` to switch accounts, `2` to sign in to a new or existing account, `3` to migrate an existing `.codex` profile, or `4` to delete a workspace after confirming its folder name.

```sh
codex-x
```

## Use

Sign in once for each account. Choose any workspace name, such as `01`, `personal`, or `work`:

```sh
codex-x login personal
codex-x login work
```

Start Codex under an account:

```sh
codex-x run personal
codex-x run work "review this project"
```

Check the selected account's login:

```sh
codex-x status work
```

For remote machines or when browser sign-in is inconvenient:

```sh
codex-x login work --device-auth
```

Account data is stored as `~/.codex-<workspace>` by default; for example, `~/.codex-personal`. Workspace names can use any valid folder name, including `01`, `personal`, or `work`. Set `CODEX_ACCOUNTS_HOME` to place those folders somewhere else.

## Existing Codex users

Existing Codex CLI users already have `~/.codex`. It is left unchanged. Sign in to a new workspace with `login`, which creates a new workspace folder.

If the current `~/.codex` login is the account you want to keep, migrate it once without signing in again:

```sh
codex-x migrate personal
```

`migrate` renames `~/.codex` to `~/.codex-personal`, preserving the stored Codex sign-in, settings, and local history. It refuses to run when the destination already exists.

This package does not handle passwords or tokens itself. It only sets `CODEX_HOME` before launching the official Codex CLI.
