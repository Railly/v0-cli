import { Command } from 'commander'
import { bullet, section } from '../lib/output/human.ts'
import { emitSuccess } from '../lib/output/json.ts'
import { findOperation, listOperations } from '../lib/schema/introspect.ts'
import { color } from '../lib/ui/color.ts'
import { detectDefaultMode } from '../lib/utils/tty.ts'

export function schemaCommand(): Command {
  return new Command('schema')
    .description('Print the request/response schema for a v0 Platform API operation (T0, offline)')
    .argument('[operationId]', 'e.g. chats.init, projects.create, deployments.create')
    .option('--json', 'force JSON output')
    .action(async (operationId: string | undefined, rawOpts: { json?: boolean }, cmd: Command) => {
      const mode =
        rawOpts.json || cmd.optsWithGlobals<{ json?: boolean }>().json
          ? 'json'
          : detectDefaultMode()
      if (!operationId) {
        const ops = await listOperations()
        if (mode === 'json') return emitSuccess(ops)
        process.stdout.write(`${section(`operations (${ops.length})`)}\n`)
        for (const op of ops) {
          process.stdout.write(
            `${bullet(`${color.accent(op.operationId.padEnd(38))} ${color.muted(`${op.method} ${op.path}`)}`)}\n`,
          )
        }
        return
      }
      const op = await findOperation(operationId)
      if (!op) {
        process.stderr.write(`[schema] unknown operationId: ${operationId}\n`)
        process.stderr.write(`${color.dim('Run `v0 schema` (no args) to list all.')}\n`)
        process.exit(2)
      }
      if (mode === 'json') return emitSuccess(op)
      process.stdout.write(`${section(op.operationId)}\n`)
      process.stdout.write(`  ${color.muted(`${op.method} ${op.path}`)}\n`)
      if (op.summary) process.stdout.write(`  ${color.dim(op.summary)}\n`)
      process.stdout.write(
        `\n${color.dim(JSON.stringify({ requestBody: op.requestBody, parameters: op.parameters, responses: op.responses }, null, 2))}\n`,
      )
    })
}
