import { Command } from 'commander'
import {
  ApiKeyWizardCancelled,
  ApiKeyWizardValidationFailed,
  runApiKeyWizard,
} from '../cli/agent/api-key-wizard.ts'
import { emitNextSteps } from '../cli/agent/next-steps.ts'
import { offerSkillInstall } from '../cli/agent/skill-installer-prompt.ts'
import { buildClient } from '../lib/api/client.ts'
import { activeProfileName, loadProfile, saveProfile } from '../lib/config/profiles.ts'
import { emitSuccess } from '../lib/output/json.ts'
import { color } from '../lib/ui/color.ts'
import { logo, tagline } from '../lib/ui/logo.ts'

export function initCommand(): Command {
  return new Command('init')
    .description(
      'First-run wizard: prompt for V0_API_KEY, save to a profile, and optionally install the agent skill.',
    )
    .argument('[profile]', 'profile name', 'default')
    .option('--skip-skill', 'do not offer to install the agent skill')
    .action(async (profileName: string, opts: { skipSkill?: boolean }) => {
      process.stdout.write(`${logo()}\n${tagline()}\n\n`)

      // Phase 1-3 — api-key-wizard (cligentic). Masked prompt, live probe
      // against api.v0.dev, save to the profile TOML on success.
      let validatedKey: string
      try {
        const result = await runApiKeyWizard({
          appName: 'v0',
          keyLocationHint: 'https://v0.app/chat/settings/keys',
          shapeHint: (v) =>
            v.startsWith('v1:') || v.length > 20
              ? undefined
              : 'That does not look like a v0 API key.',
          validateKey: async (key) => {
            const tempProfile = {
              ...(await loadProfile(profileName)),
              auth: { api_key: key },
            }
            const client = buildClient({ profile: tempProfile, apiKey: key })
            return await client.user.get()
          },
          identityLabel: (user) =>
            (user as { email?: string; id?: string }).email ??
            (user as { id?: string }).id ??
            'unknown',
          saveKey: async (key) => {
            const existing = await loadProfile(profileName)
            await saveProfile(profileName, { ...existing, auth: { api_key: key } })
          },
          title: color.brand('v0 init'),
        })
        validatedKey = result.key
        if (activeProfileName() !== profileName) {
          process.stderr.write(
            `${color.muted(
              `note: active profile is ${activeProfileName()}. Pass --profile ${profileName} or export V0_PROFILE=${profileName} to use this one.`,
            )}\n`,
          )
        }
      } catch (err) {
        if (err instanceof ApiKeyWizardCancelled) process.exit(130)
        if (err instanceof ApiKeyWizardValidationFailed) process.exit(1)
        throw err
      }

      // Phase 4 — skill-installer-prompt (cligentic). Optional, default Yes.
      const outcome = await offerSkillInstall({
        skillSlug: 'Railly/v0-cli',
        promptMessage: 'Install the agent skill for Claude Code / Cursor / MCP-aware agents?',
        skip: !!opts.skipSkill,
      })

      // Phase 5 — next-steps (cligentic). stderr NDJSON + formatted block.
      emitNextSteps(
        [
          {
            command: 'v0 doctor',
            description: 'confirm API key + network + plan + openapi all healthy',
          },
          {
            command: 'v0 "landing page with hero + pricing"',
            description: 'shorthand for chat create, try the shortest path first',
          },
          {
            command: 'v0 schema chats.init',
            description: 'introspect any of the 55 operations offline',
          },
          ...(outcome.installed
            ? []
            : [
                {
                  command: 'npx skills add Railly/v0-cli',
                  description: 'install the agent skill later',
                  optional: true,
                },
              ]),
        ],
        { json: false },
      )

      // Non-TTY path: emit success envelope for downstream scripts.
      if (!process.stdout.isTTY) {
        emitSuccess({
          profile: profileName,
          validated: validatedKey.length > 0,
          skillInstalled: outcome.installed,
        })
      }
    })
}
