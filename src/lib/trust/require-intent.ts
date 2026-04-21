import { CliError } from '../utils/errors.ts'
import { verifyAndConsumeIntent } from './intent.ts'

export async function requireIntent(opts: {
  token: string | undefined
  action: string
  params: unknown
}): Promise<void> {
  if (!opts.token) {
    throw new CliError(
      {
        code: 'intent_required',
        type: 'intent_required',
        message: `T3 operation "${opts.action}" requires --confirm <intent-token>`,
        userMessage: `This is a T3 destructive operation. Mint a token first: \`v0 intent issue "${opts.action}" --params '<json>'\`, then pass --confirm <token>.`,
      },
      5,
    )
  }
  await verifyAndConsumeIntent({ token: opts.token, action: opts.action, params: opts.params })
}
