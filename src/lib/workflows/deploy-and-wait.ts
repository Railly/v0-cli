import type { createClient } from 'v0-sdk'
import { emitNdjsonEvent } from '../output/ndjson.ts'

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
