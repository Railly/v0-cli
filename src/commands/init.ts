import { spawn } from 'node:child_process'
import * as p from '@clack/prompts'
import { Command } from 'commander'
import { emitNextSteps } from '../cli/agent/next-steps.ts'
import { buildClient } from '../lib/api/client.ts'
import { activeProfileName, loadProfile, saveProfile } from '../lib/config/profiles.ts'
import { emitSuccess } from '../lib/output/json.ts'
import { color } from '../lib/ui/color.ts'
import { logo, tagline } from '../lib/ui/logo.ts'

async function runSkillInstaller(): Promise<{ ok: boolean; detail?: string }> {
  return new Promise((resolve) => {
    const child = spawn('npx', ['-y', 'skills', 'add', 'Railly/v0-cli'], {
      stdio: 'inherit',
    })
    child.on('exit', (code) => {
      if (code === 0) resolve({ ok: true })
      else resolve({ ok: false, detail: `npx exited with code ${code ?? '?'}` })
    })
    child.on('error', (err) => resolve({ ok: false, detail: err.message }))
  })
}

export function initCommand(): Command {
  return new Command('init')
    .description(
      'First-run wizard: prompt for V0_API_KEY, save to a profile, and optionally install the agent skill.',
    )
    .argument('[profile]', 'profile name', 'default')
    .option('--skip-skill', 'do not offer to install the agent skill')
    .action(async (profileName: string, opts: { skipSkill?: boolean }) => {
      // Header. Pure presentation — init is interactive, never emits JSON.
      process.stdout.write(`${logo()}\n${tagline()}\n\n`)
      p.intro(color.brand('v0 init'))

      // 1. Prompt API key.
      const keyInput = await p.password({
        message: 'Paste your v0 API key (grab one at https://v0.app/chat/settings/keys):',
        mask: '•',
        validate: (v) => {
          if (!v || v.length < 10) return 'Key looks too short.'
          if (!v.startsWith('v1:') && v.length < 20) return 'That does not look like a v0 API key.'
          return undefined
        },
      })
      if (p.isCancel(keyInput)) {
        p.cancel('Cancelled. Nothing saved.')
        process.exit(130)
      }
      const apiKey = keyInput as string

      // 2. Validate against the live API.
      const spin = p.spinner()
      spin.start('Validating key against api.v0.dev…')
      try {
        const tempProfile = { ...(await loadProfile(profileName)), auth: { api_key: apiKey } }
        const client = buildClient({ profile: tempProfile, apiKey })
        const user = await client.user.get()
        spin.stop(
          `Key valid. Authenticated as ${color.accent(user.email ?? user.id ?? 'unknown')}.`,
        )
      } catch (err) {
        spin.stop(
          color.error(`Validation failed: ${err instanceof Error ? err.message : String(err)}`),
        )
        p.cancel('Nothing saved. Double-check the key and try again.')
        process.exit(1)
      }

      // 3. Persist to profile (mode 0600).
      const existing = await loadProfile(profileName)
      await saveProfile(profileName, { ...existing, auth: { api_key: apiKey } })
      p.log.success(
        `Saved to profile ${color.accent(profileName)}` +
          (activeProfileName() === profileName
            ? '.'
            : ` (active profile is still ${color.accent(activeProfileName())}; pass --profile ${profileName} or export V0_PROFILE=${profileName}).`),
      )

      // 4. Offer skill install.
      let skillInstalled = false
      if (!opts.skipSkill) {
        const wantsSkill = await p.confirm({
          message: 'Install the agent skill for Claude Code / Cursor / any MCP-aware agent?',
          initialValue: true,
        })
        if (p.isCancel(wantsSkill)) {
          p.log.info('Skipped skill install.')
        } else if (wantsSkill) {
          p.log.step('Running: npx -y skills add Railly/v0-cli')
          const result = await runSkillInstaller()
          if (result.ok) {
            p.log.success('Skill installed.')
            skillInstalled = true
          } else {
            p.log.warn(
              `Skill install failed (${result.detail ?? 'unknown error'}). You can retry later with: npx skills add Railly/v0-cli`,
            )
          }
        } else {
          p.log.info('Skipped skill install.')
        }
      }

      p.outro(color.success('Ready.'))

      // 5. Structured next-steps (cligentic block). stderr NDJSON when piped,
      //    human block when TTY. Agents reading the stream can chain from here.
      emitNextSteps(
        [
          {
            command: 'v0 doctor',
            description: 'confirm API key + network + plan + openapi all healthy',
          },
          {
            command: 'v0 "landing page with hero + pricing"',
            description: 'shorthand for chat create — try the shortest path first',
          },
          {
            command: 'v0 schema chats.init',
            description: 'introspect any of the 55 operations offline',
          },
          ...(skillInstalled
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

      // 6. Also emit a structured success envelope so downstream scripts can
      //    pipe `v0 init --json` in the future. For now init is TTY-only but
      //    we still give a record of what happened.
      if (!process.stdout.isTTY) {
        emitSuccess({
          profile: profileName,
          skillInstalled,
          validated: true,
        })
      }
    })
}
