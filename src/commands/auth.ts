import * as p from '@clack/prompts'
import { Command } from 'commander'
import { activeProfileName, loadProfile, saveProfile } from '../lib/config/profiles.ts'
import { bullet, kv, section } from '../lib/output/human.ts'
import { emitSuccess } from '../lib/output/json.ts'
import { runCommand } from '../lib/runner.ts'
import { color } from '../lib/ui/color.ts'

export function authCommand(): Command {
  const cmd = new Command('auth').description('Authenticate with v0 and inspect the active account')

  cmd
    .command('status')
    .description('Show whether V0_API_KEY is configured and valid')
    .action(
      runCommand(async ({ client, mode }) => {
        const user = await client.user.get()
        if (mode === 'json') {
          emitSuccess({ ok: true, user })
          return
        }
        process.stdout.write(`${section('v0 auth status')}\n`)
        process.stdout.write(`${kv('state', color.success('authenticated'))}\n`)
        process.stdout.write(`${kv('user', user.email ?? user.id ?? '(unknown)')}\n`)
        process.stdout.write(`${kv('user id', user.id ?? '—')}\n`)
      }),
    )

  cmd
    .command('whoami')
    .description('Combined view: user + scopes + plan + rate-limits')
    .action(
      runCommand(async ({ client, mode }) => {
        const [user, scopes, plan, rateLimits] = await Promise.all([
          client.user.get(),
          client.user.getScopes(),
          client.user.getPlan(),
          client.rateLimits.find(),
        ])

        if (mode === 'json') {
          emitSuccess({ user, scopes, plan, rateLimits })
          return
        }

        process.stdout.write(`${section('whoami')}\n`)
        process.stdout.write(`${kv('email', user.email ?? '—')}\n`)
        process.stdout.write(`${kv('user id', user.id ?? '—')}\n`)
        process.stdout.write(`${kv('plan', plan.plan ?? '—')}\n`)
        if (plan.balance) {
          process.stdout.write(
            `${kv('credits', `${plan.balance.remaining}/${plan.balance.total}`)}\n`,
          )
        }
        process.stdout.write(
          `${kv('rate limit', `${rateLimits.remaining ?? '—'}/${rateLimits.limit}`)}\n`,
        )
        if (rateLimits.dailyLimit) {
          process.stdout.write(
            `${kv('daily', `${rateLimits.dailyLimit.remaining}/${rateLimits.dailyLimit.limit}${rateLimits.dailyLimit.isWithinGracePeriod ? ' (grace)' : ''}`)}\n`,
          )
        }
        process.stdout.write(`\n${section('scopes')}\n`)
        const scopeList = Array.isArray(scopes)
          ? scopes
          : ((scopes as { data?: unknown[] }).data ?? [])
        if (!scopeList.length) {
          process.stdout.write(`${bullet(color.dim('(no additional scopes)'))}\n`)
        } else {
          for (const s of scopeList as Array<Record<string, unknown>>) {
            process.stdout.write(`${bullet(`${s.id ?? '(id?)'} — ${s.name ?? s.type ?? '—'}`)}\n`)
          }
        }
      }),
    )

  cmd
    .command('login')
    .description('Interactively save a V0 API key to a profile')
    .argument('[profile]', 'profile name', 'default')
    .action(async (profileName: string) => {
      p.intro(color.brand('v0 auth login'))
      const key = await p.password({
        message: 'Paste your v0 API key (from https://v0.app/chat/settings/keys):',
        mask: '•',
        validate: (v) => {
          if (!v || v.length < 10) return 'Key looks too short.'
          if (v.startsWith('v1:') || v.length > 20) return undefined
          return 'That does not look like a v0 key'
        },
      })
      if (p.isCancel(key)) {
        p.cancel('Cancelled.')
        process.exit(1)
      }
      const existing = await loadProfile(profileName)
      await saveProfile(profileName, { ...existing, auth: { api_key: key as string } })
      p.outro(
        `Saved to profile ${color.accent(profileName)}. Current active profile: ${color.accent(activeProfileName())}.`,
      )
    })

  return cmd
}
