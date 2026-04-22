import { Command } from 'commander'
import { section } from '../lib/output/human.ts'
import { emitSuccess } from '../lib/output/json.ts'
import { runCommand } from '../lib/runner.ts'
import { color } from '../lib/ui/color.ts'
import { aggregateUsage, renderUsage, type UsageEvent } from '../lib/viz/usage-view.ts'

interface UsageResponse {
  data?: UsageEvent[]
  pagination?: { hasMore?: boolean; nextCursor?: string }
}

type ChatLite = { id: string; name?: string; title?: string }
interface ChatsResponse {
  data?: ChatLite[]
}

export function reportCommand(): Command {
  const cmd = new Command('report').description('Usage and activity reports')

  cmd
    .command('usage')
    .description('Usage report with aggregated charts (agents use --json for raw)')
    .option('--start <date>', 'ISO start date')
    .option('--end <date>', 'ISO end date')
    .option('--chat <id>', 'filter by chat id')
    .option('--user <id>', 'filter by user id')
    .option('--limit <n>', 'max events to fetch for aggregation (max 150)', '150')
    .option('--cursor <c>', 'pagination cursor')
    .option(
      '--since <range>',
      'shortcut: 24h, 7d, 30d (wins over --start). Default: 7d',
    )
    .option(
      '--compare',
      'fetch the previous window too so the dashboard shows a trend delta',
    )
    .action(
      runCommand(async ({ client, mode, cmd, recordResult }) => {
        const raw = cmd.opts<{
          start?: string
          end?: string
          chat?: string
          user?: string
          limit?: string
          cursor?: string
          since?: string
          compare?: boolean
        }>()

        // Resolve window
        const now = new Date()
        let startDate: Date | undefined
        let endDate: Date | undefined
        if (raw.end) endDate = new Date(raw.end)
        if (raw.start) startDate = new Date(raw.start)
        if (raw.since && !startDate) {
          const m = /^(\d+)([hdw])$/.exec(raw.since)
          if (m) {
            const n = Number.parseInt(m[1] ?? '0', 10)
            const unit = m[2]
            const ms =
              unit === 'h'
                ? n * 60 * 60 * 1000
                : unit === 'w'
                  ? n * 7 * 24 * 60 * 60 * 1000
                  : n * 24 * 60 * 60 * 1000
            endDate = endDate ?? now
            startDate = new Date(endDate.getTime() - ms)
          }
        }
        // Default: last 7d
        if (!startDate) {
          endDate = endDate ?? now
          startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000)
        }
        endDate = endDate ?? now

        // Fetch current window
        const params: Record<string, unknown> = {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        }
        if (raw.chat) params.chatId = raw.chat
        if (raw.user) params.userId = raw.user
        if (raw.limit) params.limit = Number(raw.limit)
        if (raw.cursor) params.cursor = raw.cursor

        const res = (await client.reports.getUsage(params)) as UsageResponse
        const events = Array.isArray(res.data) ? res.data : []

        // Optional previous window for trend comparison
        let prevTotal: number | undefined
        if (raw.compare) {
          const windowMs = endDate.getTime() - startDate.getTime()
          const prevEnd = startDate
          const prevStart = new Date(prevEnd.getTime() - windowMs)
          try {
            const prevRes = (await client.reports.getUsage({
              startDate: prevStart.toISOString(),
              endDate: prevEnd.toISOString(),
              limit: Number(raw.limit ?? '150'),
            })) as UsageResponse
            const prevEvents = Array.isArray(prevRes.data) ? prevRes.data : []
            prevTotal = prevEvents.reduce((a, e) => {
              const v = typeof e.totalCost === 'number' ? e.totalCost : Number.parseFloat(String(e.totalCost ?? 0))
              return a + (Number.isFinite(v) ? v : 0)
            }, 0)
          } catch {
            // Previous window failed — skip trend without blowing up the dashboard
          }
        }

        recordResult({ eventCount: events.length, window: { startDate, endDate } })

        if (mode === 'json') return emitSuccess(res)

        // Pick a bucket count based on window span.
        const spanDays = Math.max(
          1,
          Math.round((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)),
        )
        const buckets = Math.min(30, Math.max(5, spanDays))

        const agg = aggregateUsage(events, { start: startDate, end: endDate, buckets })

        // Best-effort name lookup. Two passes:
        //   1. One chat.list (limit 100) — cheap, covers recent chats.
        //   2. For the top 5 chats by cost that are still unnamed, fetch each
        //      individually in parallel. Bounded concurrency so we don't
        //      hammer the API.
        const chatNames = new Map<string, string>()
        if (agg.byChat.size > 0) {
          try {
            const chatsRes = (await client.chats.find({ limit: 100 })) as ChatsResponse
            const list = Array.isArray(chatsRes.data) ? chatsRes.data : []
            for (const c of list) {
              if (c.id) chatNames.set(c.id, c.name ?? c.title ?? '')
            }
          } catch {
            // Non-fatal. Continue with per-chat fallback.
          }

          const topIds = [...agg.byChat.values()]
            .sort((a, b) => b.cost - a.cost)
            .slice(0, 5)
            .map((c) => c.chatId)
            .filter((id) => !chatNames.has(id) || !chatNames.get(id))

          if (topIds.length > 0) {
            const results = await Promise.allSettled(
              topIds.map((chatId) => client.chats.getById({ chatId })),
            )
            for (let i = 0; i < topIds.length; i++) {
              const id = topIds[i]
              if (!id) continue
              const r = results[i]
              if (r?.status === 'fulfilled') {
                const c = r.value as ChatLite
                chatNames.set(id, c.name ?? c.title ?? '')
              }
            }
          }
        }

        process.stdout.write(
          `${renderUsage(agg, chatNames, prevTotal !== undefined ? { prevTotal } : {})}\n`,
        )

        if (res.pagination?.hasMore) {
          process.stdout.write(
            `${color.dim(`  more events available — page with --cursor ${res.pagination.nextCursor ?? '<cursor>'}`)}\n`,
          )
        }
      }),
    )

  cmd
    .command('activity')
    .description('Per-user activity report')
    .option('--start <date>', 'ISO start date')
    .option('--end <date>', 'ISO end date')
    .action(
      runCommand(async ({ client, mode, cmd }) => {
        const raw = cmd.opts<{ start?: string; end?: string }>()
        const params: Record<string, unknown> = {}
        if (raw.start) params.startDate = raw.start
        if (raw.end) params.endDate = raw.end
        const res = await client.reports.getUserActivity(params)
        if (mode === 'json') return emitSuccess(res)
        process.stdout.write(`${section('user activity')}\n`)
        process.stdout.write(`${color.dim(JSON.stringify(res, null, 2))}\n`)
      }),
    )

  return cmd
}
