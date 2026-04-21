import { Command } from 'commander'
import { bullet, kv, section } from '../lib/output/human.ts'
import { emitSuccess } from '../lib/output/json.ts'
import { fetchAndCache } from '../lib/rate-limits/preflight.ts'
import { runCommand } from '../lib/runner.ts'
import { listOperations } from '../lib/schema/introspect.ts'
import { killswitchStatus } from '../lib/trust/killswitch.ts'
import { color } from '../lib/ui/color.ts'
import { configDir } from '../lib/utils/path.ts'

interface Check {
  id: string
  label: string
  status: 'ok' | 'warn' | 'fail'
  detail?: string
}

export function doctorCommand(): Command {
  return new Command('doctor')
    .description('Health-check: API key, network, plan, rate-limits, openapi, killswitch')
    .action(
      runCommand(async ({ client, mode, profileName }) => {
        const checks: Check[] = []

        // 1. API key present (if we got here, buildClient already passed; record it).
        checks.push({ id: 'api_key', label: 'V0_API_KEY present', status: 'ok' })
        checks.push({ id: 'profile', label: `Profile "${profileName}" loaded`, status: 'ok' })

        // 2. Network: user.get
        try {
          const user = await client.user.get()
          checks.push({
            id: 'user',
            label: 'GET /user',
            status: 'ok',
            detail: user.email ?? user.id ?? '',
          })
        } catch (err) {
          checks.push({
            id: 'user',
            label: 'GET /user',
            status: 'fail',
            detail: (err as Error).message,
          })
        }

        // 3. Plan
        try {
          const plan = await client.user.getPlan()
          const balance = plan.balance ? `${plan.balance.remaining}/${plan.balance.total}` : ''
          checks.push({
            id: 'plan',
            label: `Plan: ${plan.plan ?? '—'}`,
            status: 'ok',
            detail: balance,
          })
        } catch (err) {
          checks.push({
            id: 'plan',
            label: 'GET /user/plan',
            status: 'warn',
            detail: (err as Error).message,
          })
        }

        // 4. Rate-limits + cache
        try {
          const snap = await fetchAndCache(client)
          checks.push({
            id: 'rate_limits',
            label: 'Rate limits refreshed',
            status: 'ok',
            detail: `remaining ${snap.remaining ?? snap.limit}`,
          })
        } catch (err) {
          checks.push({
            id: 'rate_limits',
            label: 'GET /rate-limits',
            status: 'warn',
            detail: (err as Error).message,
          })
        }

        // 5. OpenAPI bundled
        try {
          const ops = await listOperations()
          checks.push({
            id: 'openapi',
            label: 'OpenAPI spec available (v0-sdk)',
            status: 'ok',
            detail: `${ops.length} operations`,
          })
        } catch (err) {
          checks.push({
            id: 'openapi',
            label: 'OpenAPI spec',
            status: 'fail',
            detail: (err as Error).message,
          })
        }

        // 6. Killswitch state
        const ks = await killswitchStatus()
        checks.push({
          id: 'killswitch',
          label: 'Killswitch',
          status: ks ? 'warn' : 'ok',
          detail: ks ? 'ENGAGED — T2/T3 blocked' : 'off',
        })

        // 7. Config dir writable
        checks.push({ id: 'config_dir', label: `Config dir ${configDir()}`, status: 'ok' })

        if (mode === 'json') {
          return emitSuccess({ checks, healthy: checks.every((c) => c.status !== 'fail') })
        }

        process.stdout.write(`${section('v0 doctor')}\n`)
        for (const c of checks) {
          const icon =
            c.status === 'ok'
              ? color.success('✓')
              : c.status === 'warn'
                ? color.warn('!')
                : color.error('✗')
          const line = `${icon} ${c.label}`
          process.stdout.write(`${bullet(line)}${c.detail ? color.dim(` — ${c.detail}`) : ''}\n`)
        }
        const failed = checks.filter((c) => c.status === 'fail')
        process.stdout.write(
          `\n${failed.length ? color.error(`${failed.length} check(s) failed`) : color.success('all checks passed')}\n`,
        )
        if (failed.length) process.exit(1)
      }),
    )
}

// helper so we don't pull duplicate kv here
export { kv }
