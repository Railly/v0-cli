import type { createClient } from 'v0-sdk'
import { emitNdjsonEvent } from '../output/ndjson.ts'
import type { StepEvent } from '../streaming/step-renderer.ts'

type V0Client = ReturnType<typeof createClient>

export interface DeployPreview {
  projectId?: string
  projectName?: string
  chatId: string
  versionId: string
  versionFiles?: number
  vercelProjectId?: string
  hooks?: Array<{ id: string; name?: string; events?: string[] }>
  planRemaining?: number | undefined
  planTotal?: number | undefined
}

export async function buildDeployPreview(
  client: V0Client,
  params: { chatId: string; versionId: string; projectId?: string },
): Promise<DeployPreview> {
  const chatPromise = client.chats.getById({ chatId: params.chatId }).catch(() => null)
  const versionPromise = client.chats
    .getVersion({ chatId: params.chatId, versionId: params.versionId })
    .catch(() => null)
  const hooksPromise = client.hooks.find().catch(() => null)
  const planPromise = client.user.getPlan().catch(() => null)
  const projectByChat = params.projectId
    ? null
    : await client.projects.getByChatId({ chatId: params.chatId }).catch(() => null)

  const [chat, version, hooks, plan] = await Promise.all([
    chatPromise,
    versionPromise,
    hooksPromise,
    planPromise,
  ])

  const chatDetail = chat as unknown as {
    projectId?: string
    vercelProjectId?: string
    name?: string
  } | null
  const projectId = params.projectId ?? projectByChat?.id ?? chatDetail?.projectId
  const versionDetail = version as unknown as { files?: unknown[] } | null
  const hookList = ((hooks as unknown as { data?: Array<Record<string, unknown>> })?.data ??
    []) as Array<Record<string, unknown>>
  const planDetail = plan as unknown as { balance?: { remaining?: number; total?: number } } | null

  const out: DeployPreview = {
    chatId: params.chatId,
    versionId: params.versionId,
  }
  if (projectId) out.projectId = projectId
  if (chatDetail?.name) out.projectName = chatDetail.name
  if (versionDetail?.files) out.versionFiles = versionDetail.files.length
  if (chatDetail?.vercelProjectId) out.vercelProjectId = chatDetail.vercelProjectId
  if (hookList.length) {
    out.hooks = hookList
      .filter((h) => {
        const events = (h.events as string[] | undefined) ?? []
        return events.some((e) => e.startsWith('deployment'))
      })
      .map((h) => {
        const hook: { id: string; name?: string; events?: string[] } = {
          id: String(h.id ?? ''),
        }
        if (h.name !== undefined) hook.name = String(h.name)
        if (Array.isArray(h.events)) hook.events = h.events as string[]
        return hook
      })
  }
  if (planDetail?.balance) {
    if (planDetail.balance.remaining !== undefined) out.planRemaining = planDetail.balance.remaining
    if (planDetail.balance.total !== undefined) out.planTotal = planDetail.balance.total
  }
  return out
}

export interface PollOpts {
  deploymentId: string
  timeoutSec: number
  intervalSec?: number
  ndjson?: boolean
}

export interface PollResult {
  deployment: Record<string, unknown>
  durationMs: number
  reason: 'terminal' | 'timeout'
  lastLogTs?: number
}

const TERMINAL_STATUSES = new Set([
  'ready',
  'READY',
  'error',
  'ERROR',
  'cancelled',
  'CANCELED',
  'canceled',
])

/**
 * Async-generator variant of `pollDeployment`. Yields `StepEvent`s that the
 * generic step-renderer can consume so `deploy create --wait` feels like the
 * chat streaming UX (past-tense steps, rolling `Thinking…`, timer, summary).
 *
 * Mechanics:
 *  - When the polled status transitions, emit a `step` event with the
 *    past-tense label of the PREVIOUS status (so you see what just finished).
 *  - Between transitions, emit `idle` events with the present-continuous
 *    label so the spinner reads `Building · 45s` instead of `Thinking…`.
 *  - On terminal state, emit `meta` rows (id, url, status) then `done` or
 *    `error`.
 *  - Caller still awaits a `PollResult` via the returned thenable for the
 *    JSON-mode audit envelope.
 */
export async function* streamDeployment(
  client: V0Client,
  opts: PollOpts,
): AsyncGenerator<StepEvent, PollResult, void> {
  const intervalMs = (opts.intervalSec ?? 3) * 1000
  const deadline = Date.now() + opts.timeoutSec * 1000
  let lastLogTs = 0
  let deployment: Record<string, unknown> = {}

  // Prime: fetch once so we have the webUrl + inspectorUrl for probing.
  // v0's DeploymentDetail doesn't expose a status field, so we rely on
  // HTTP probes against the webUrl to decide 'terminal' instead.
  try {
    const current = await client.deployments.getById({ deploymentId: opts.deploymentId })
    deployment = current as unknown as Record<string, unknown>
  } catch {
    // retry inside the loop
  }

  const webUrl = (deployment.webUrl as string) || (deployment.url as string) || ''
  const inspectorUrl = (deployment.inspectorUrl as string) || ''

  // Emit an initial idle so the spinner has a label immediately instead
  // of rendering blank for the first few seconds.
  yield { kind: 'idle', label: 'Queued' }

  // Heuristic phase detection from Vercel build logs. The real log text is
  // unstructured ('Running "install" command: `bun install`...',
  // 'Compiled successfully in 2.3s', 'Build Completed in /vercel/output [6s]',
  // 'Deployment completed'). Match the authoritative signals below.
  const seenPhases = new Set<string>()
  const phasePatterns: Array<{ re: RegExp; complete: string; nextIdle: string }> = [
    { re: /Retrieving list of deployment files/i, complete: 'Retrieved files', nextIdle: 'Downloading' },
    { re: /Downloading .* deployment files/i, complete: 'Downloaded files', nextIdle: 'Installing' },
    { re: /Running .+install. command/i, complete: 'Installing…', nextIdle: 'Installing' },
    { re: /Creating an optimized production build/i, complete: 'Install complete', nextIdle: 'Compiling' },
    { re: /Compiled successfully/i, complete: 'Compiled', nextIdle: 'Optimizing' },
    { re: /Finalizing page optimization/i, complete: 'Optimized', nextIdle: 'Building' },
    { re: /Build Completed in/i, complete: 'Built', nextIdle: 'Deploying' },
    { re: /Deploying outputs/i, complete: 'Uploaded outputs', nextIdle: 'Finalizing' },
  ]

  // Terminal signals — one of these means the deploy is live.
  const TERMINAL_SUCCESS = /Deployment completed/i
  const TERMINAL_ERROR =
    /Build failed|Error:|Deployment failed|Command "vercel build" exited with/i

  const finish = (
    kind: 'success' | 'error',
    errMsg?: string,
  ): {
    event: StepEvent
    result: PollResult
  } => {
    const result: PollResult = {
      deployment,
      durationMs: Date.now() - (deadline - opts.timeoutSec * 1000),
      reason: 'terminal',
    }
    if (lastLogTs) result.lastLogTs = lastLogTs
    return {
      event:
        kind === 'success'
          ? { kind: 'done' }
          : {
              kind: 'error',
              message: errMsg ?? 'Deployment failed — check the inspector for details.',
            },
      result,
    }
  }

  while (Date.now() < deadline) {
    // Tail logs from v0 API. The real shape is { data: { logs: [...] } }
    // with entries having { text, level, createdAt, type } — NOT
    // { message, timestamp }. We key on createdAt parsed to millis.
    let terminalEvent:
      | { kind: 'success' }
      | { kind: 'error'; message: string }
      | null = null

    try {
      const rawLogs = (await client.deployments.findLogs({
        deploymentId: opts.deploymentId,
      })) as unknown as {
        data?: { logs?: Array<{ text?: string; createdAt?: string; level?: string }> }
      }
      const entries = rawLogs?.data?.logs ?? []

      for (const entry of entries) {
        const createdAt = entry.createdAt ? Date.parse(entry.createdAt) : 0
        if (Number.isFinite(createdAt) && createdAt > 0) {
          lastLogTs = Math.max(lastLogTs, createdAt)
        }
        const text = entry.text ?? ''
        if (!text) continue

        // Phase matching.
        for (const phase of phasePatterns) {
          if (seenPhases.has(phase.complete)) continue
          if (phase.re.test(text)) {
            seenPhases.add(phase.complete)
            yield { kind: 'step', label: phase.complete }
            yield { kind: 'idle', label: phase.nextIdle }
            break
          }
        }

        // Terminal signals override everything — break out as soon as one
        // lands so we don't keep polling after the deploy is done.
        if (TERMINAL_SUCCESS.test(text)) {
          terminalEvent = { kind: 'success' }
          break
        }
        if (TERMINAL_ERROR.test(text)) {
          terminalEvent = { kind: 'error', message: text.slice(0, 200) }
          break
        }
      }
    } catch {
      // logs can fail while queued — ignore, we'll retry next interval
    }

    if (terminalEvent) {
      if (terminalEvent.kind === 'success') {
        yield { kind: 'step', label: 'Deployed' }
        if (typeof deployment.id === 'string') {
          yield { kind: 'meta', key: 'deploy', value: deployment.id }
        }
        if (webUrl) yield { kind: 'meta', key: 'url', value: webUrl, accent: true }
        if (inspectorUrl) {
          yield { kind: 'meta', key: 'inspector', value: inspectorUrl, accent: true }
        }
        const { event, result } = finish('success')
        yield event
        return result
      }
      const { event, result } = finish('error', terminalEvent.message)
      yield event
      return result
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  // Timeout — emit a synthetic error so the renderer closes cleanly.
  yield { kind: 'error', message: `Timed out after ${opts.timeoutSec}s` }
  const result: PollResult = {
    deployment,
    durationMs: opts.timeoutSec * 1000,
    reason: 'timeout',
  }
  if (lastLogTs) result.lastLogTs = lastLogTs
  return result
}

export async function pollDeployment(client: V0Client, opts: PollOpts): Promise<PollResult> {
  const intervalMs = (opts.intervalSec ?? 3) * 1000
  const deadline = Date.now() + opts.timeoutSec * 1000
  let lastLogTs = 0
  let deployment: Record<string, unknown> = {}

  while (Date.now() < deadline) {
    const current = await client.deployments.getById({ deploymentId: opts.deploymentId })
    deployment = current as unknown as Record<string, unknown>

    if (opts.ndjson) {
      emitNdjsonEvent('deployment', { id: opts.deploymentId, status: deployment.status })
    }

    try {
      const logs = (await client.deployments.findLogs({
        deploymentId: opts.deploymentId,
        ...(lastLogTs ? { since: lastLogTs } : {}),
      })) as unknown as { data?: Array<{ timestamp?: number; message?: string }> } | Array<unknown>

      const entries = Array.isArray(logs)
        ? (logs as Array<{ timestamp?: number; message?: string }>)
        : (logs.data ?? [])
      if (opts.ndjson) {
        for (const entry of entries) {
          if (entry.timestamp && entry.timestamp > lastLogTs) lastLogTs = entry.timestamp
          emitNdjsonEvent('log', entry)
        }
      } else if (entries.length > 0) {
        const latest = entries[entries.length - 1]
        if (latest?.timestamp) lastLogTs = latest.timestamp
      }
    } catch {
      // logs can fail while queued; ignore and keep polling
    }

    const status = String(deployment.status ?? '').toLowerCase()
    if (TERMINAL_STATUSES.has(deployment.status as string) || TERMINAL_STATUSES.has(status)) {
      if (status.includes('error') || status === 'cancelled' || status === 'canceled') {
        try {
          const errors = await client.deployments.findErrors({ deploymentId: opts.deploymentId })
          if (opts.ndjson) emitNdjsonEvent('errors', errors)
        } catch {
          // swallow — surfaced via status
        }
      }
      const result: PollResult = {
        deployment,
        durationMs: Date.now() - (deadline - opts.timeoutSec * 1000),
        reason: 'terminal',
      }
      if (lastLogTs) result.lastLogTs = lastLogTs
      return result
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  const result: PollResult = {
    deployment,
    durationMs: opts.timeoutSec * 1000,
    reason: 'timeout',
  }
  if (lastLogTs) result.lastLogTs = lastLogTs
  return result
}
