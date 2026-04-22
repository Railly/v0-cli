import { Command } from 'commander'
import { bullet, kv, section, table } from '../lib/output/human.ts'
import { emitSuccess } from '../lib/output/json.ts'
import { emitNdjsonEvent } from '../lib/output/ndjson.ts'
import { runCommand } from '../lib/runner.ts'
import { renderSteps } from '../lib/streaming/step-renderer.ts'
import { confirmOrAbort } from '../lib/trust/confirm.ts'
import { requireIntent } from '../lib/trust/require-intent.ts'
import { color } from '../lib/ui/color.ts'
import { CliError } from '../lib/utils/errors.ts'
import { readBatchItems, runBatch } from '../lib/workflows/batch.ts'
import {
  buildDeployPreview,
  pollDeployment,
  streamDeployment,
} from '../lib/workflows/deploy-and-wait.ts'

export function deployCommand(): Command {
  const cmd = new Command('deploy').description(
    'Vercel deployments (list, show, logs, errors, create, delete).',
  )

  cmd
    .command('list')
    .description('Find deployments by projectId + chatId + versionId')
    .requiredOption('--project <id>', 'project id')
    .requiredOption('--chat <id>', 'chat id')
    .requiredOption('--version <id>', 'version id')
    .action(
      runCommand(async ({ client, mode, cmd }) => {
        const raw = cmd.opts<{ project: string; chat: string; version: string }>()
        const res = await client.deployments.find({
          projectId: raw.project,
          chatId: raw.chat,
          versionId: raw.version,
        })
        if (mode === 'json') return emitSuccess(res)
        const rows = (res as unknown as { data?: Array<Record<string, unknown>> }).data ?? []
        process.stdout.write(`${section(`deployments (${rows.length})`)}\n`)
        process.stdout.write(
          `${table(rows, [
            { key: 'id', header: 'id' },
            { key: 'status', header: 'status' },
            { key: 'url', header: 'url' },
            { key: 'createdAt', header: 'created' },
          ])}\n`,
        )
      }),
    )

  cmd
    .command('show <deployment-id>')
    .description('Show one deployment')
    .action(
      runCommand(async ({ client, mode, cmd }) => {
        const [deploymentId] = cmd.args as [string]
        const res = await client.deployments.getById({ deploymentId })
        if (mode === 'json') return emitSuccess(res)
        process.stdout.write(`${section(`deployment ${deploymentId}`)}\n`)
        process.stdout.write(`${color.dim(JSON.stringify(res, null, 2))}\n`)
      }),
    )

  cmd
    .command('logs <deployment-id>')
    .description('Logs for a deployment')
    .option('--since <unix-ms>', 'only logs newer than this timestamp')
    .action(
      runCommand(async ({ client, mode, cmd }) => {
        const [deploymentId] = cmd.args as [string]
        const raw = cmd.opts<{ since?: string }>()
        const params: { deploymentId: string; since?: number } = { deploymentId }
        if (raw.since) params.since = Number(raw.since)
        const res = await client.deployments.findLogs(params)
        if (mode === 'json') return emitSuccess(res)
        process.stdout.write(`${section(`logs ${deploymentId}`)}\n`)
        process.stdout.write(`${color.dim(JSON.stringify(res, null, 2))}\n`)
      }),
    )

  cmd
    .command('errors <deployment-id>')
    .description('Errors for a deployment')
    .action(
      runCommand(async ({ client, mode, cmd }) => {
        const [deploymentId] = cmd.args as [string]
        const res = await client.deployments.findErrors({ deploymentId })
        if (mode === 'json') return emitSuccess(res)
        process.stdout.write(`${section(`errors ${deploymentId}`)}\n`)
        process.stdout.write(`${color.dim(JSON.stringify(res, null, 2))}\n`)
      }),
    )

  cmd
    .command('create <chat-id> [version-id]')
    .description(
      "Deploy a chat version to Vercel (T2). Omit version-id to use the chat's latest version. Auto-creates a project from the chat title if none is assigned (unless --no-auto-project).",
    )
    .option('--project <id>', 'project id (defaults to chat owner)')
    .option('--no-auto-project', "don't auto-create a project when the chat has none")
    .option('--wait', 'poll logs + errors until deployment reaches terminal state')
    .option('--interval <seconds>', 'poll interval', '3')
    .action(
      runCommand(async ({ client, mode, opts, cmd, recordResult }) => {
        const [chatId, explicitVersionId] = cmd.args as [string, string | undefined]
        const raw = cmd.opts<{
          project?: string
          autoProject?: boolean
          wait?: boolean
          interval?: string
        }>()

        // Resolve version-id when not given. `findVersions(limit=1)` returns
        // the newest. This is pure DX: agents should still pass explicit ids
        // for audit clarity, but humans + one-shots no longer need the
        // jq pipeline.
        let versionId = explicitVersionId
        if (!versionId) {
          const versions = (await client.chats.findVersions({ chatId, limit: 1 })) as {
            data?: Array<{ id?: string }>
          }
          const latest = versions.data?.[0]?.id
          if (!latest) {
            throw new CliError(
              {
                code: 'version_unresolved',
                type: 'validation_error',
                message: 'no versions found for chat',
                userMessage: `Could not find any versions for chat ${chatId}. Create one with msg send first, or pass an explicit version-id.`,
              },
              4,
            )
          }
          versionId = latest
          if (mode === 'human') {
            process.stderr.write(
              `${color.dim('[deploy]')} ${color.muted('resolved latest version →')} ${color.accent(latest)}\n`,
            )
          }
        }
        const preview = await buildDeployPreview(client, {
          chatId,
          versionId,
          ...(raw.project ? { projectId: raw.project } : {}),
        })

        // If the chat has no project yet, auto-create one from the chat title
        // and assign it. Controlled by --no-auto-project (opt-out). Agents
        // that want deterministic behavior pass --project explicitly or
        // --no-auto-project to get the old error with the recovery hint.
        let autoCreatedProject: { id: string; name: string } | undefined
        if (!preview.projectId && raw.autoProject !== false) {
          // Resolve a name: chat title → chat name → 'Untitled <chatId>'.
          const chat = (await client.chats.getById({ chatId }).catch(() => null)) as {
            title?: string
            name?: string
          } | null
          const projectName =
            chat?.title || chat?.name || `Untitled ${chatId.slice(0, 8)}`

          if (mode === 'human') {
            process.stderr.write(
              `${color.dim('[deploy]')} ${color.muted('no project on chat →')} ${color.muted('creating')} ${color.accent(`"${projectName}"`)}\n`,
            )
          }

          const created = (await client.projects.create({
            name: projectName,
          })) as { id?: string; name?: string }
          if (!created.id) {
            throw new CliError(
              {
                code: 'project_create_failed',
                type: 'validation_error',
                message: 'auto-create project returned no id',
              },
              1,
            )
          }
          await client.projects.assign({ projectId: created.id, chatId })
          autoCreatedProject = { id: created.id, name: created.name ?? projectName }
          preview.projectId = created.id
          preview.projectName = created.name ?? projectName

          if (mode === 'human') {
            process.stderr.write(
              `${color.dim('[deploy]')} ${color.muted('assigned chat to project')} ${color.accent(created.id)}\n`,
            )
          }
        }

        if (!preview.projectId) {
          // Fallback: auto-create was disabled or failed silently. Show the
          // recovery hint with the top few existing projects.
          let hint =
            'Could not determine projectId. Pass --project <id>, or run `v0 project assign <project-id> ' +
            chatId +
            '` to link this chat to a project first.'
          if (mode === 'human') {
            try {
              const list = (await client.projects.find()) as {
                data?: Array<{ id?: string; name?: string }>
              }
              const items = (list.data ?? []).filter(
                (p): p is { id: string; name?: string } => typeof p.id === 'string',
              )
              if (items.length > 0) {
                const top = items.slice(0, 5)
                const lines = top
                  .map((p) => `  ${color.muted(p.id.padEnd(14))} ${p.name ?? ''}`)
                  .join('\n')
                hint =
                  `Could not determine projectId for chat ${chatId}. Pick one of your projects:\n${lines}\n\nThen pass --project <id>, or assign permanently:\n  v0 project assign <project-id> ${chatId}`
              }
            } catch {
              // ignore — fall back to the plain hint
            }
          }
          throw new CliError(
            {
              code: 'project_unresolved',
              type: 'validation_error',
              message: 'could not resolve projectId',
              userMessage: hint,
            },
            2,
          )
        }

        if (opts.dryRun) {
          const envelope = {
            dryRun: true,
            input: { chatId, versionId, projectId: preview.projectId },
            preview,
            status: 'would-deploy',
          }
          recordResult(envelope)
          if (mode === 'json') return emitSuccess(envelope)
          renderPreview('deploy preview (dry-run)', preview as unknown as Record<string, unknown>)
          return
        }

        // T2 confirm gate
        const confirmPreview: Record<string, string> = {
          chat: chatId,
          version: versionId,
          project: preview.projectId,
        }
        if (preview.projectName) confirmPreview.name = preview.projectName
        if (autoCreatedProject) {
          confirmPreview.project = `${autoCreatedProject.id} (just created)`
        }
        if (preview.vercelProjectId) confirmPreview.vercel = preview.vercelProjectId
        if (preview.versionFiles !== undefined) confirmPreview.files = String(preview.versionFiles)
        if (preview.hooks?.length)
          confirmPreview.hooks = `${preview.hooks.length} deployment hook(s) will fire`
        if (preview.planRemaining !== undefined && preview.planTotal !== undefined)
          confirmPreview.credits = `${preview.planRemaining}/${preview.planTotal}`

        await confirmOrAbort({
          title: 'Deploy to Vercel',
          preview: confirmPreview,
          question: 'Create deployment?',
          yes: !!opts.yes,
          mode,
        })

        const deployment = await client.deployments.create({
          projectId: preview.projectId,
          chatId,
          versionId,
        })
        recordResult(deployment)

        if (!raw.wait) {
          if (mode === 'json') return emitSuccess(deployment)
          const detail = deployment as unknown as {
            id?: string
            status?: string
            webUrl?: string
            url?: string
          }
          process.stdout.write(`${section('deployment created')}\n`)
          process.stdout.write(`${kv('id', detail.id ?? '—')}\n`)
          process.stdout.write(`${kv('status', detail.status ?? '—')}\n`)
          if (detail.webUrl) process.stdout.write(`${kv('url', detail.webUrl)}\n`)
          else if (detail.url) process.stdout.write(`${kv('url', detail.url)}\n`)
          return
        }

        const detail = deployment as unknown as { id?: string }
        const deploymentId = detail.id
        if (!deploymentId) {
          if (mode === 'json') return emitSuccess(deployment)
          return
        }
        const timeoutSec = Number(opts.waitTimeout ?? '600')
        const intervalSec = Number(raw.interval ?? '3')

        if (mode === 'human') {
          // Same UX as chat create / msg send: past-tense step transcript
          // with a rolling `Thinking…` spinner, status transitions emerge
          // as steps (Queued · 2s, Building · 45s, …), final summary lists
          // deploy id + url.
          //
          // streamDeployment is an async-generator — it yields StepEvents
          // for the renderer AND returns a PollResult when done. The
          // renderer only consumes the yielded iterable, so we wrap it in
          // a thin iterator that captures the return value for audit.
          const stream = streamDeployment(client, { deploymentId, timeoutSec, intervalSec })
          let pollResult: Awaited<ReturnType<typeof pollDeployment>> | undefined
          const forRenderer = (async function* () {
            while (true) {
              const it = await stream.next()
              if (it.done) {
                pollResult = it.value
                return
              }
              yield it.value
            }
          })()
          const renderResult = await renderSteps(forRenderer, {
            intro: 'v0 deploy create',
            subtitle: `${chatId} · ${versionId}`,
            idleLabel: 'Queued',
          })
          recordResult({
            ...(deployment as unknown as Record<string, unknown>),
            waitResult: pollResult,
          })
          if (renderResult.error) process.exit(1)
          return
        }

        // JSON mode — keep the existing polling path so agents can pipe
        // the NDJSON stream through jq.
        const result = await pollDeployment(client, {
          deploymentId,
          timeoutSec,
          intervalSec,
          ndjson: true,
        })
        recordResult({ ...(deployment as unknown as Record<string, unknown>), waitResult: result })
        return emitSuccess({
          deployment: result.deployment,
          reason: result.reason,
          durationMs: result.durationMs,
        })
      }),
    )

  cmd
    .command('batch')
    .description(
      'Deploy many versions sequentially. Reads NDJSON of {chatId, versionId, projectId?} from --from or stdin. T2 per item.',
    )
    .option('--from <path>', 'source file (ndjson or json array). omit for stdin.')
    .option('--on-error <mode>', 'continue|stop', 'continue')
    .action(
      runCommand(async ({ client, mode, opts, cmd, recordResult }) => {
        const raw = cmd.opts<{ from?: string; onError?: 'continue' | 'stop' }>()
        const items =
          (await readBatchItems<{
            chatId: string
            versionId: string
            projectId?: string
          }>(raw.from ?? 'stdin')) ?? []
        if (!items.length) throw new Error('batch input is empty')
        if (!opts.yes) {
          await confirmOrAbort({
            title: `Batch deploy ${items.length} version(s)`,
            preview: {
              count: String(items.length),
              onError: raw.onError ?? 'continue',
            },
            question: 'Start batch?',
            yes: false,
            mode,
          })
        }
        const { summary, entries } = await runBatch({
          items,
          label: 'deploy',
          ndjson: mode === 'json',
          onError: raw.onError ?? 'continue',
          run: async ({ idx, item }) => {
            const preview = await buildDeployPreview(client, {
              chatId: item.chatId,
              versionId: item.versionId,
              ...(item.projectId ? { projectId: item.projectId } : {}),
            })
            if (!preview.projectId)
              throw new Error(`item ${idx}: could not resolve projectId for ${item.chatId}`)
            return client.deployments.create({
              projectId: preview.projectId,
              chatId: item.chatId,
              versionId: item.versionId,
            })
          },
        })
        recordResult({ summary, entries: entries.length })
        if (mode === 'json') return emitSuccess({ summary })
        process.stdout.write(`${section('batch summary')}\n`)
        process.stdout.write(`${kv('total', summary.total)}\n`)
        process.stdout.write(`${kv('ok', summary.ok)}\n`)
        process.stdout.write(`${kv('errors', summary.errors)}\n`)
        process.stdout.write(`${kv('skipped', summary.skipped)}\n`)
      }),
    )

  cmd
    .command('delete <deployment-id>')
    .description('Delete a deployment (T3 — requires --confirm <intent-token>)')
    .action(
      runCommand(async ({ client, mode, opts, cmd, recordResult }) => {
        const [deploymentId] = cmd.args as [string]
        await requireIntent({
          token: opts.confirm,
          action: 'deploy delete',
          params: { deploymentId },
        })
        const res = await client.deployments.delete({ deploymentId })
        recordResult(res)
        if (mode === 'json') return emitSuccess(res)
        process.stdout.write(`${bullet(`deleted deployment ${color.accent(deploymentId)}`)}\n`)
      }),
    )

  return cmd
}

function renderPreview(title: string, preview: Record<string, unknown>): void {
  process.stdout.write(`${section(title)}\n`)
  for (const [k, v] of Object.entries(preview)) {
    if (v === undefined || v === null) continue
    if (typeof v === 'object') {
      process.stdout.write(`${kv(k, JSON.stringify(v))}\n`)
    } else {
      process.stdout.write(`${kv(k, String(v))}\n`)
    }
  }
}
