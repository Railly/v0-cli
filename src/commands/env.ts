import { Command } from 'commander'
import { bullet, kv, section, table } from '../lib/output/human.ts'
import { emitSuccess } from '../lib/output/json.ts'
import { runCommand } from '../lib/runner.ts'
import { confirmOrAbort } from '../lib/trust/confirm.ts'
import { classifyEnvSet } from '../lib/trust/ladder.ts'
import { requireIntent } from '../lib/trust/require-intent.ts'
import { color } from '../lib/ui/color.ts'
import { CliError } from '../lib/utils/errors.ts'
import { mergeParams, parseParamsJson } from '../lib/validation/params.ts'
import { diffLocalVsRemote, readDotEnv, writeDotEnv } from '../lib/workflows/dotenv.ts'

function parseSetItems(
  items: string[],
  paramsBody?: Record<string, unknown>,
): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = []
  for (const raw of items) {
    const [key, ...rest] = raw.split('=')
    if (!key || !rest.length) {
      throw new CliError(
        {
          code: 'validation_error',
          type: 'validation_error',
          message: `invalid --set entry: ${raw}`,
          userMessage: `Use --set KEY=VALUE (got ${raw})`,
        },
        2,
      )
    }
    out.push({ key, value: rest.join('=') })
  }
  if (paramsBody?.environmentVariables && Array.isArray(paramsBody.environmentVariables)) {
    for (const pair of paramsBody.environmentVariables as Array<Record<string, unknown>>) {
      if (typeof pair?.key === 'string' && typeof pair?.value === 'string') {
        out.push({ key: pair.key, value: pair.value })
      }
    }
  }
  return out
}

export function envCommand(): Command {
  const cmd = new Command('env').description(
    'Project env vars (list, get, set, update, delete, pull, push).',
  )

  cmd
    .command('list <project-id>')
    .description('List env vars. Pass --decrypted to reveal values (T2 gate).')
    .option('--decrypted', 'return decrypted values')
    .action(
      runCommand(async ({ client, mode, opts, cmd }) => {
        const [projectId] = cmd.args as [string]
        const raw = cmd.opts<{ decrypted?: boolean }>()
        if (raw.decrypted) {
          await confirmOrAbort({
            title: 'Reveal decrypted env vars',
            preview: {
              project: projectId,
              note: 'Decrypted values will print to stdout.',
            },
            question: 'Reveal values?',
            yes: !!opts.yes,
            mode,
          })
        }
        const res = await client.projects.findEnvVars({
          projectId,
          ...(raw.decrypted ? { decrypted: true } : {}),
        })
        if (mode === 'json') return emitSuccess(res)
        const rows = ((res as unknown as { data?: Array<Record<string, unknown>> }).data ??
          []) as Array<Record<string, unknown>>
        process.stdout.write(`${section(`env vars of ${projectId} (${rows.length})`)}\n`)
        process.stdout.write(
          `${table(rows, [
            { key: 'id', header: 'id' },
            { key: 'key', header: 'key' },
            {
              key: 'value',
              header: 'value',
              format: (v) => (v === undefined ? color.dim('(redacted)') : String(v)),
            },
          ])}\n`,
        )
      }),
    )

  cmd
    .command('get <project-id> <env-var-id>')
    .description('Get one env var. --decrypted reveals the value (T2 gate).')
    .option('--decrypted', 'return decrypted value')
    .action(
      runCommand(async ({ client, mode, opts, cmd }) => {
        const [projectId, environmentVariableId] = cmd.args as [string, string]
        const raw = cmd.opts<{ decrypted?: boolean }>()
        if (raw.decrypted) {
          await confirmOrAbort({
            title: 'Reveal decrypted env var',
            preview: { project: projectId, var: environmentVariableId },
            question: 'Reveal value?',
            yes: !!opts.yes,
            mode,
          })
        }
        const res = await client.projects.getEnvVar({
          projectId,
          environmentVariableId,
          ...(raw.decrypted ? { decrypted: true } : {}),
        })
        if (mode === 'json') return emitSuccess(res)
        process.stdout.write(`${section(`env var ${environmentVariableId}`)}\n`)
        process.stdout.write(`${color.dim(JSON.stringify(res, null, 2))}\n`)
      }),
    )

  cmd
    .command('set <project-id> [entries...]')
    .description(
      'Create env var(s). Entries as KEY=VALUE (repeatable). T1 for plain keys, T2 when key matches a secret pattern.',
    )
    .option('--upsert', 'overwrite existing keys', true)
    .option('--set <entry>', 'KEY=VALUE (repeatable)', collect, [] as string[])
    .option('--params <json>', 'raw JSON body (merged)')
    .action(
      runCommand(async ({ client, mode, opts, profile, cmd, recordResult }) => {
        const [projectId, ...positional] = cmd.args as string[]
        if (!projectId) throw new Error('project id required')
        const raw = cmd.opts<{ upsert?: boolean; set?: string[]; params?: string }>()
        const entries = parseSetItems(
          [...positional, ...(raw.set ?? [])],
          parseParamsJson(raw.params),
        )
        if (!entries.length) throw new Error('pass at least one KEY=VALUE')

        const patterns = profile.trust?.secret_patterns ?? [
          '*SECRET*',
          '*KEY*',
          '*TOKEN*',
          '*_SK_*',
          '*PRIVATE*',
        ]
        const level = classifyEnvSet(
          entries.map((e) => e.key),
          patterns,
        )
        if (level === 'T2') {
          const secretKeys = entries.map((e) => e.key).filter((k) => keyMatchesAny(k, patterns))
          await confirmOrAbort({
            title: 'Set secret env var(s)',
            preview: {
              project: projectId,
              keys: entries.map((e) => e.key).join(', '),
              secret: secretKeys.join(', '),
            },
            question: 'Write secret values?',
            yes: !!opts.yes,
            mode,
          })
        }

        const body = mergeParams(
          {
            environmentVariables: entries,
            ...(raw.upsert !== undefined ? { upsert: raw.upsert } : { upsert: true }),
          },
          parseParamsJson(raw.params),
        )
        const res = await client.projects.createEnvVars({
          projectId,
          ...(body as {
            environmentVariables: Array<{ key: string; value: string }>
            upsert?: boolean
          }),
        })
        recordResult({ level, count: entries.length, result: res })
        if (mode === 'json') return emitSuccess(res)
        process.stdout.write(`${bullet(`wrote ${entries.length} env var(s) (trust: ${level})`)}\n`)
      }),
    )

  cmd
    .command('update <project-id> [pairs...]')
    .description('Update existing env var values. Entries as ID=VALUE (repeatable).')
    .option('--pair <entry>', 'ID=VALUE (repeatable)', collect, [] as string[])
    .option('--params <json>', 'raw JSON body')
    .action(
      runCommand(async ({ client, mode, cmd, recordResult }) => {
        const [projectId, ...positional] = cmd.args as string[]
        if (!projectId) throw new Error('project id required')
        const raw = cmd.opts<{ pair?: string[]; params?: string }>()
        const entries: Array<{ id: string; value: string }> = []
        for (const pair of [...positional, ...(raw.pair ?? [])]) {
          const [id, ...rest] = pair.split('=')
          if (!id || !rest.length) throw new Error(`invalid --pair entry: ${pair}`)
          entries.push({ id, value: rest.join('=') })
        }
        if (!entries.length && !raw.params)
          throw new Error('pass at least one ID=VALUE or --params')
        const body = mergeParams(
          entries.length ? { environmentVariables: entries } : {},
          parseParamsJson(raw.params),
        )
        const res = await client.projects.updateEnvVars({
          projectId,
          ...(body as { environmentVariables: Array<{ id: string; value: string }> }),
        })
        recordResult(res)
        if (mode === 'json') return emitSuccess(res)
        process.stdout.write(`${bullet(`updated ${entries.length} env var(s)`)}\n`)
      }),
    )

  cmd
    .command('delete <project-id> [env-var-ids...]')
    .description(
      'Delete env var(s). Single id → T2 confirm. Bulk (>1) → T3 intent token (V5). For now both paths require --yes.',
    )
    .option('--params <json>', 'raw JSON body')
    .action(
      runCommand(async ({ client, mode, opts, cmd, recordResult }) => {
        const [projectId, ...ids] = cmd.args as string[]
        if (!projectId) throw new Error('project id required')
        if (!ids.length && !cmd.opts<{ params?: string }>().params) {
          throw new Error('pass one or more env var ids, or --params')
        }
        if (ids.length > 1) {
          await requireIntent({
            token: opts.confirm,
            action: 'env delete',
            params: { projectId, environmentVariableIds: ids },
          })
        } else {
          await confirmOrAbort({
            title: 'Delete env var',
            preview: { project: projectId, ids: ids.join(', ') },
            question: `Delete env var?`,
            yes: !!opts.yes,
            mode,
          })
        }
        const res = await client.projects.deleteEnvVars({
          projectId,
          environmentVariableIds: ids,
        })
        recordResult(res)
        if (mode === 'json') return emitSuccess(res)
        process.stdout.write(`${bullet(`deleted ${ids.length} env var(s)`)}\n`)
      }),
    )

  cmd
    .command('pull <project-id>')
    .description('Pull decrypted env vars from v0 into a local .env file (T2 gate).')
    .option('--out <path>', 'destination file', '.env')
    .action(
      runCommand(async ({ client, mode, opts, cmd, recordResult }) => {
        const [projectId] = cmd.args as [string]
        const raw = cmd.opts<{ out?: string }>()
        await confirmOrAbort({
          title: 'Pull decrypted env vars to disk',
          preview: { project: projectId, out: raw.out ?? '.env' },
          question: 'Pull values to disk?',
          yes: !!opts.yes,
          mode,
        })
        const res = await client.projects.findEnvVars({ projectId, decrypted: true })
        const vars = ((res as unknown as { data?: Array<Record<string, unknown>> }).data ??
          []) as Array<Record<string, unknown>>
        const entries = vars.map((v) => ({
          key: String(v.key ?? ''),
          value: String(v.value ?? ''),
        }))
        await writeDotEnv(raw.out ?? '.env', entries)
        recordResult({ written: entries.length, out: raw.out ?? '.env' })
        if (mode === 'json') return emitSuccess({ written: entries.length, out: raw.out ?? '.env' })
        process.stdout.write(
          `${bullet(`wrote ${entries.length} env var(s) to ${color.accent(raw.out ?? '.env')}`)}\n`,
        )
      }),
    )

  cmd
    .command('push <project-id>')
    .description('Push local .env into v0 (creates + updates). Does NOT delete remote-only keys.')
    .option('--from <path>', 'source .env file', '.env')
    .option('--yes', 'skip confirm for secret keys')
    .action(
      runCommand(async ({ client, mode, opts, profile, cmd, recordResult }) => {
        const [projectId] = cmd.args as [string]
        const raw = cmd.opts<{ from?: string }>()
        const local = await readDotEnv(raw.from ?? '.env')
        if (!local.length) throw new Error(`No entries found in ${raw.from ?? '.env'}`)
        const remote = await client.projects.findEnvVars({ projectId, decrypted: true })
        const remoteData = ((remote as unknown as { data?: Array<Record<string, unknown>> }).data ??
          []) as Array<Record<string, unknown>>
        const remoteEntries = remoteData.map((v) => ({
          id: String(v.id ?? ''),
          key: String(v.key ?? ''),
          value: v.value === undefined ? undefined : String(v.value),
        }))
        const diff = diffLocalVsRemote(local, remoteEntries)

        const patterns = profile.trust?.secret_patterns ?? [
          '*SECRET*',
          '*KEY*',
          '*TOKEN*',
          '*_SK_*',
          '*PRIVATE*',
        ]
        const changedKeys = [...diff.toCreate.map((e) => e.key), ...diff.toUpdate.map((e) => e.key)]
        const level = classifyEnvSet(changedKeys, patterns)
        if (level === 'T2' && (diff.toCreate.length > 0 || diff.toUpdate.length > 0)) {
          await confirmOrAbort({
            title: 'Push env vars (contains secrets)',
            preview: {
              project: projectId,
              create: diff.toCreate.map((e) => e.key).join(', ') || '(none)',
              update: diff.toUpdate.map((e) => e.key).join(', ') || '(none)',
              remoteOnly: diff.toDelete.map((e) => e.key).join(', ') || '(none; left untouched)',
            },
            question: 'Apply changes?',
            yes: !!opts.yes,
            mode,
          })
        }

        const createResult = diff.toCreate.length
          ? await client.projects.createEnvVars({
              projectId,
              environmentVariables: diff.toCreate,
              upsert: true,
            })
          : null
        const remoteIdByKey = new Map(remoteEntries.map((r) => [r.key, r.id]))
        const updatePayload = diff.toUpdate
          .map((u) => {
            const id = remoteIdByKey.get(u.key)
            return id ? { id, value: u.value } : null
          })
          .filter((v): v is { id: string; value: string } => v !== null)
        const updateResult = updatePayload.length
          ? await client.projects.updateEnvVars({
              projectId,
              environmentVariables: updatePayload,
            })
          : null

        const summary = {
          created: diff.toCreate.length,
          updated: updatePayload.length,
          unchanged: diff.unchanged.length,
          remoteOnly: diff.toDelete.length,
        }
        recordResult({ summary, createResult, updateResult })
        if (mode === 'json') return emitSuccess(summary)
        process.stdout.write(`${section('env push')}\n`)
        process.stdout.write(`${kv('created', summary.created)}\n`)
        process.stdout.write(`${kv('updated', summary.updated)}\n`)
        process.stdout.write(`${kv('unchanged', summary.unchanged)}\n`)
        process.stdout.write(`${kv('remote only', summary.remoteOnly)}\n`)
      }),
    )

  return cmd
}

function collect(value: string, prev: string[]): string[] {
  return [...prev, value]
}

function keyMatchesAny(key: string, patterns: string[]): boolean {
  return patterns.some((p) => {
    const re = new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`)
    return re.test(key)
  })
}
