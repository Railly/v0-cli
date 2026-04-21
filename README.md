# v0-cli

Agent-first CLI for the [v0 Platform API](https://v0.app/docs/api/platform) (`api.v0.dev/v1`).

Built for AI agents as the primary user, with a human supervisor. Every command ships with a JSON contract, the trust ladder gates destructive operations, and an audit trail lands every run in `~/.v0cli/audit/`.

## Install (V1)

V1 is a read-only slice of the full CLI. Every mutating operation lives behind V2+ slices (see `04_Projects/_active/v0-cli/breadboarding.md`).

```bash
bun install
bun run dev -- doctor
```

Local development binary:

```bash
bun link
v0 doctor
```

## V1 scope (what ships today)

| Group | Commands | Trust |
|-------|----------|-------|
| `auth` | `status`, `whoami`, `login` | T0 |
| `user` | `get`, `plan`, `billing`, `scopes` | T0 |
| `rate-limits` | — | T0 |
| `doctor` | — | T0 |
| `project` | `list`, `show`, `show-by-chat` | T0 |
| `chat` | `list`, `show` | T0 |
| `version` | `list`, `show` | T0 |
| `msg` | `list`, `show` | T0 |
| `deploy` | `list`, `show`, `logs`, `errors` | T0 |
| `hook` | `list`, `show` | T0 |
| `mcp-server` | `list`, `show` | T0 |
| `integrations` | `vercel list` | T0 |
| `report` | `usage`, `activity` | T0 |
| `schema` | — | T0 |
| `audit tail` | — | T0 |
| `killswitch` | `on`, `off`, `status` | — (local only) |

## Global flags

- `--json` — force machine-readable output (auto when stdout is not a TTY)
- `--fields <list>` — whitelist top-level keys in JSON output
- `--profile <name>` — switch active profile (default: `default`)
- `--base-url <url>` — override API base (default `https://api.v0.dev/v1`)
- `--api-key <key>` — override `V0_API_KEY` for one invocation
- `--scope <id>` — for billing / rate-limit scope
- `--force` — bypass client-side rate-limit preflight

## Environment

| Var | Purpose |
|-----|---------|
| `V0_API_KEY` | Bearer token (from [v0.app/chat/settings/keys](https://v0.app/chat/settings/keys)) |
| `V0_BASE_URL` | Override API base URL |
| `V0_PROFILE` | Override active profile |
| `V0_CLI_CONFIG_DIR` | Override `~/.v0cli` (tests) |
| `V0_CLI_NO_AUDIT` | Skip audit writes (ephemeral CI) |
| `NO_COLOR` / `FORCE_COLOR` | Standard color envs |

## Design docs

The recon, shape, breadboard, and scaffold live in Hunter's vault:

```
04_Projects/_active/v0-cli/
  recon.md         — 55 operationIds, auth, quirks
  shaping.md       — command surface, trust ladder, locked decisions
  breadboarding.md — places, affordances, 5 flows, slicing V1-V6
  scaffold.md      — directory + package + state layout
  skill-draft.md   — agent-facing usage guide
```

## Roadmap

- **V1** (this commit) — auth + reads + doctor + schema + audit + killswitch.
- **V2** — `chat init`, `chat create`, `msg send` (SSE), `version update`, audit pending→ok.
- **V3** — `deploy create --wait`, T2 confirm gate, kill-switch enforcement.
- **V4** — env-var CRUD + batch orchestrator + rate-limit pre-flight.
- **V5** — intent tokens + T3 destructive ops + Kapso delivery.
- **V6** — `v0 mcp --transport stdio` exposing T0/T1 tools to Claude Code.

## License

MIT
