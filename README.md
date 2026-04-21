# v0-cli

Agent-first CLI for the [v0 Platform API](https://v0.app/docs/api/platform).

Single `v0` binary. 55 operations across chats, projects, versions, messages, deployments, env vars, webhooks, MCP servers. Stable JSON output, trust ladder, audit trail, single-use intent tokens for destructive ops.

```bash
bun install -g @crafter/v0-cli   # or `bun link` from source
v0 doctor --json
```

Requires `V0_API_KEY` from [v0.app/chat/settings/keys](https://v0.app/chat/settings/keys).

## Skill

For agents (Claude Code, Cursor, custom):

```bash
npx skills add Railly/v0-cli
```

The skill teaches agents the preflight recipe (doctor → schema → rate-limits), the JSON contract, the T0/T1/T2/T3 trust ladder, and the intent-token flow for destructive operations. Source: [`skill/SKILL.md`](./skill/SKILL.md).

## Links

- Docs + design: [v0-cli.crafter.run](https://v0-cli.crafter.run)
- v0 Platform API: https://v0.app/docs/api/platform
- v0-sdk: https://github.com/vercel/v0-sdk

## License

MIT
