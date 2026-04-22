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

// Canonical mapping from raw Vercel/v0 deployment status strings to the
// past-tense label the human renderer surfaces. Unknown statuses fall
// through — they'll show as idle labels so the transcript stays clean.
const STATUS_MAP: Record<string, { active: string; complete: string }> = {
  queued: { active: 'Queueing', complete: 'Queued' },
  QUEUED: { active: 'Queueing', complete: 'Queued' },
  initializing: { active: 'Initializing', complete: 'Initialized' },
  INITIALIZING: { active: 'Initializing', complete: 'Initialized' },
  building: { active: 'Building', complete: 'Built' },
  BUILDING: { active: 'Building', complete: 'Built' },
  uploading: { active: 'Uploading', complete: 'Uploaded' },
  UPLOADING: { active: 'Uploading', complete: 'Uploaded' },
  deploying: { active: 'Deploying', complete: 'Deployed' },
  DEPLOYING: { active: 'Deploying', complete: 'Deployed' },
}

function statusToLabels(
  raw: string | undefined,
): { active: string; complete: string } | null {
  if (!raw) return null
  return STATUS_MAP[raw] ?? STATUS_MAP[raw.toLowerCase()] ?? null
}

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
  let lastStatus: string | undefined
  let deployment: Record<string, unknown> = {}

  while (Date.now() < deadline) {
    const current = await client.deployments.getById({ deploymentId: opts.deploymentId })
    deployment = current as unknown as Record<string, unknown>
    const status = deployment.status as string | undefined

    // On status change, close the previous step with its past-tense label
    // and switch the idle label to the new status's present-continuous form.
    if (status !== lastStatus) {
      const prev = statusToLabels(lastStatus)
      if (prev) {
        yield { kind: 'step', label: prev.complete }
      }
      const next = statusToLabels(status)
      if (next) {
        yield { kind: 'idle', label: next.active }
      } else if (status) {
        // Unknown status — still surface the raw label so the user isn't lost.
        yield { kind: 'idle', label: String(status) }
      }
      lastStatus = status
    }

    // Tail logs (kept from original implementation) so JSON mode stays
    // informative for agents piping through jq.
    try {
      const logs = (await client.deployments.findLogs({
        deploymentId: opts.deploymentId,
        ...(lastLogTs ? { since: lastLogTs } : {}),
      })) as unknown as { data?: Array<{ timestamp?: number; message?: string }> } | Array<unknown>
      const entries = Array.isArray(logs)
        ? (logs as Array<{ timestamp?: number; message?: string }>)
        : (logs.data ?? [])
      for (const entry of entries) {
        if (entry.timestamp && entry.timestamp > lastLogTs) lastLogTs = entry.timestamp
      }
    } catch {
      // logs can fail while queued — ignore
    }

    if (TERMINAL_STATUSES.has(status ?? '') || TERMINAL_STATUSES.has((status ?? '').toLowerCase())) {
      // Close out the last active step with its past-tense form if we had one.
      const last = statusToLabels(lastStatus)
      if (last && !TERMINAL_STATUSES.has(lastStatus ?? '')) {
        yield { kind: 'step', label: last.complete }
      }

      const lowered = (status ?? '').toLowerCase()
      const isError = lowered.includes('error') || lowered === 'cancelled' || lowered === 'canceled'

      // Surface metadata (id, url, final status) in the summary.
      if (typeof deployment.id === 'string') {
        yield { kind: 'meta', key: 'deploy', value: deployment.id }
      }
      if (typeof deployment.url === 'string') {
        yield { kind: 'meta', key: 'url', value: deployment.url, accent: true }
      }
      if (typeof deployment.readyState === 'string' && !deployment.status) {
        yield { kind: 'meta', key: 'status', value: deployment.readyState }
      } else if (status) {
        yield { kind: 'meta', key: 'status', value: status }
      }

      const result: PollResult = {
        deployment,
        durationMs: Date.now() - (deadline - opts.timeoutSec * 1000),
        reason: 'terminal',
      }
      if (lastLogTs) result.lastLogTs = lastLogTs

      if (isError) {
        // Try to pull the first error message for the error event body.
        let errMsg = `Deployment ${lowered}`
        try {
          const errors = (await client.deployments.findErrors({
            deploymentId: opts.deploymentId,
          })) as unknown as { data?: Array<{ message?: string }> } | Array<{ message?: string }>
          const list = Array.isArray(errors) ? errors : (errors.data ?? [])
          const first = list[0]
          if (first?.message) errMsg = first.message
        } catch {
          // keep default
        }
        yield { kind: 'error', message: errMsg }
      } else {
        yield { kind: 'done' }
      }
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
