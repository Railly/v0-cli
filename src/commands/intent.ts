import { Command } from 'commander'
import { bullet, kv, section, table } from '../lib/output/human.ts'
import { emitSuccess } from '../lib/output/json.ts'
import { runCommand } from '../lib/runner.ts'
import { deliverIntentViaWhatsApp } from '../lib/trust/delivery.ts'
import { listIntents, mintIntentToken, purgeExpired } from '../lib/trust/intent.ts'
import { color } from '../lib/ui/color.ts'
import { parseParamsJson } from '../lib/validation/params.ts'

const ALLOWED_ACTIONS = new Set([
  'project delete',
  'project delete --delete-all-chats',
  'env delete',
  'deploy delete',
  'hook delete',
  'mcp-server delete',
])

export function intentCommand(): Command {
  const cmd = new Command('intent').description(
    'Single-use intent tokens for T3 destructive operations.',
  )

  cmd
    .command('issue <action>')
    .description(
      'Mint an intent token for a T3 action (e.g. "env delete"). Token is single-use, defaults to 15min TTL.',
    )
    .option('--params <json>', 'params that the destructive op will receive (bound into the token)')
    .option(
      '--whatsapp',
      'also deliver a preview via Kapso (requires profile.delivery.whatsapp_phone and V0_CLI_KAPSO_TOKEN)',
    )
    .action(
      runCommand(async ({ mode, profile, cmd, recordResult }) => {
        const [action] = cmd.args as [string]
        if (!ALLOWED_ACTIONS.has(action)) {
          throw new Error(
            `Unknown action "${action}". Allowed: ${[...ALLOWED_ACTIONS].join(', ')}.`,
          )
        }
        const raw = cmd.opts<{ params?: string; whatsapp?: boolean }>()
        const params = parseParamsJson(raw.params)
        const { token, payload } = await mintIntentToken({ action, params, profile })
        const delivery = raw.whatsapp
          ? await deliverIntentViaWhatsApp(profile, {
              action,
              params,
              token,
              expiresAt: payload.expiresAt,
            })
          : null
        const envelope = {
          token,
          action,
          params,
          expiresAt: payload.expiresAt,
          expiresAtIso: new Date(payload.expiresAt).toISOString(),
          delivery,
        }
        // Keep the token out of the audit result — only the id/hash survives.
        recordResult({
          id: payload.id,
          action,
          paramsHash: payload.paramsHash,
          expiresAt: payload.expiresAt,
          deliveredVia: delivery?.channel,
          delivered: delivery?.ok,
        })
        if (mode === 'json') return emitSuccess(envelope)
        process.stdout.write(`${section('intent issued')}\n`)
        process.stdout.write(`${kv('action', action)}\n`)
        process.stdout.write(`${kv('expires', envelope.expiresAtIso)}\n`)
        if (delivery) {
          process.stdout.write(
            `${kv('whatsapp', delivery.ok ? color.success('sent') : color.warn(delivery.error ?? 'failed'))}\n`,
          )
        }
        process.stdout.write('\n')
        process.stdout.write(`${color.bold('token')}\n  ${color.accent(token)}\n`)
      }),
    )

  cmd
    .command('list')
    .description('List known intent tokens (consumed + expired included)')
    .action(
      runCommand(async ({ mode }) => {
        const entries = await listIntents()
        if (mode === 'json') return emitSuccess(entries)
        const rows = entries.map((e) => ({
          id: e.id,
          action: e.action,
          issued: new Date(e.issuedAt).toISOString(),
          expires: new Date(e.expiresAt).toISOString(),
          state: e.consumedAt ? 'consumed' : e.expiresAt < Date.now() ? 'expired' : 'active',
        }))
        process.stdout.write(`${section(`intents (${rows.length})`)}\n`)
        process.stdout.write(
          `${table(rows, [
            { key: 'id', header: 'id' },
            { key: 'action', header: 'action' },
            { key: 'state', header: 'state' },
            { key: 'issued', header: 'issued' },
            { key: 'expires', header: 'expires' },
          ])}\n`,
        )
      }),
    )

  cmd
    .command('purge')
    .description('Delete consumed + expired intent files from ~/.v0cli/intents')
    .action(
      runCommand(async ({ mode, recordResult }) => {
        const purged = await purgeExpired()
        recordResult({ purged })
        if (mode === 'json') return emitSuccess({ purged })
        process.stdout.write(`${bullet(`purged ${color.accent(String(purged))} intent file(s)`)}\n`)
      }),
    )

  return cmd
}
