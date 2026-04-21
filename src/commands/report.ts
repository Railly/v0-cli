import { Command } from 'commander'
import { section } from '../lib/output/human.ts'
import { emitSuccess } from '../lib/output/json.ts'
import { runCommand } from '../lib/runner.ts'
import { color } from '../lib/ui/color.ts'

export function reportCommand(): Command {
  const cmd = new Command('report').description('Usage and activity reports')

  cmd
    .command('usage')
    .description('Usage report')
    .option('--start <date>', 'ISO start date')
    .option('--end <date>', 'ISO end date')
    .option('--chat <id>', 'filter by chat id')
    .option('--user <id>', 'filter by user id')
    .option('--limit <n>', 'max rows')
    .option('--cursor <c>', 'pagination cursor')
    .action(
      runCommand(async ({ client, mode, cmd }) => {
        const raw = cmd.opts<{
          start?: string
          end?: string
          chat?: string
          user?: string
          limit?: string
          cursor?: string
        }>()
        const params: Record<string, unknown> = {}
        if (raw.start) params.startDate = raw.start
        if (raw.end) params.endDate = raw.end
        if (raw.chat) params.chatId = raw.chat
        if (raw.user) params.userId = raw.user
        if (raw.limit) params.limit = Number(raw.limit)
        if (raw.cursor) params.cursor = raw.cursor
        const res = await client.reports.getUsage(params)
        if (mode === 'json') return emitSuccess(res)
        process.stdout.write(`${section('usage report')}\n`)
        process.stdout.write(`${color.dim(JSON.stringify(res, null, 2))}\n`)
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
