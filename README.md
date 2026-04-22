# v0-cli

Agent-first CLI for the [v0 Platform API](https://v0.app/docs/api/platform).

Single `v0` binary covering the entire Platform API. Stable JSON output, trust ladder, audit trail, single-use intent tokens for destructive ops.

```bash
bun install -g @crafter/v0-cli   # or `bun link` from source
v0 doctor --json
```

Requires `V0_API_KEY` from [v0.app/chat/settings/keys](https://v0.app/chat/settings/keys).

## Shorthand

`v0 <arg>` routes by the shape of the arg — no `chat create` / `chat init` ceremony:

```bash
v0 "landing page with hero and pricing"              # → chat create (prompt)
v0 .                                                 # → chat init (cwd)
v0 ./my-project                                      # → chat init (files)
v0 https://github.com/vercel/next.js                 # → chat init (repo)
v0 https://v0.app/templates/<slug>-<id>              # → chat init (template)
v0 template_abc                                      # → chat init (template id)
v0 https://example.com/dist.zip                      # → chat init (zip)
```

Core workflow:

```bash
v0 msg send <chat-id> "swap the hero copy"           # iterate (streams live)
v0 version download <chat> <ver> --out ./build.zip   # pull the archive
v0 deploy create <chat> --yes                        # ship (auto version, auto project, live transcript)
v0 "hero" --background --json                        # fire-and-forget for agents
```

Run `v0 --help` for the full table.

## Skill

For agents (Claude Code, Cursor, custom):

```bash
v0 skill install       # self-contained, audit-logged
v0 skill status        # check if your local copy is current
v0 skill update        # pull the latest (idempotent)
v0 skill uninstall     # remove

# Or directly:
npx skills add Railly/v0-cli
```

The skill teaches agents the preflight recipe (doctor → schema → rate-limits), the JSON contract, the T0/T1/T2/T3 trust ladder, and the intent-token flow for destructive operations. Source: [`skill/SKILL.md`](./skill/SKILL.md).

## Built on cligentic

The foundation primitives (audit log, killswitch, XDG paths, error map,
doctor checks, global flags, JSON mode, next-steps) are
[cligentic](https://cligentic.railly.dev) blocks, copy-pasted into
[`src/cli/`](./src/cli) via `bunx shadcn@latest add`. v0-cli dogfoods
the registry: if something breaks or a pattern is missing, the fix lands
upstream first, then gets re-pulled here.

## Links

- Docs + design: [v0-cli.crafter.run](https://v0-cli.crafter.run)
- v0 Platform API: https://v0.app/docs/api/platform
- v0-sdk: https://github.com/vercel/v0-sdk
- cligentic registry: https://cligentic.railly.dev

## License

MIT
