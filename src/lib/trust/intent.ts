import { createHmac, randomBytes } from 'node:crypto'
import { readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Profile } from '../config/profiles.ts'
import { CliError } from '../utils/errors.ts'
import { ensureConfigDir, intentsDir } from '../utils/path.ts'

export interface IntentPayload {
  id: string
  action: string
  paramsHash: string
  issuedAt: number
  expiresAt: number
  consumedAt?: number
}

export interface IntentFile extends IntentPayload {
  sig: string
}

export interface IntentToken {
  id: string
  sig: string
  expiresAt: number
}

const TOKEN_VERSION = 'v1'

function hashParams(params: unknown): string {
  const canonical = JSON.stringify(params, Object.keys((params ?? {}) as object).sort())
  return createHmac('sha256', 'v0cli-params').update(canonical).digest('hex')
}

async function loadSecret(): Promise<string> {
  const path = join(intentsDir(), '.secret')
  try {
    return (await readFile(path, 'utf8')).trim()
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    await ensureConfigDir()
    const generated = randomBytes(32).toString('hex')
    await writeFile(path, `${generated}\n`, { mode: 0o600 })
    return generated
  }
}

function intentPath(id: string): string {
  return join(intentsDir(), `${id}.json`)
}

export function formatIntentToken(token: IntentToken): string {
  return `${TOKEN_VERSION}.${token.id}.${token.sig}`
}

export function parseIntentToken(raw: string): IntentToken {
  const parts = raw.trim().split('.')
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) {
    throw new CliError(
      {
        code: 'intent_invalid',
        type: 'intent_invalid',
        message: 'malformed intent token',
        userMessage: 'Intent token is malformed. Expected v1.<id>.<sig>.',
      },
      5,
    )
  }
  return { id: parts[1]!, sig: parts[2]!, expiresAt: 0 }
}

export interface MintOpts {
  action: string
  params: unknown
  profile: Profile
}

export async function mintIntentToken(opts: MintOpts): Promise<{
  token: string
  payload: IntentPayload
}> {
  await ensureConfigDir()
  const secret = await loadSecret()
  const id = `intent_${randomBytes(8).toString('hex')}`
  const now = Date.now()
  const ttlMinutes = opts.profile.trust?.intent_ttl_minutes ?? 15
  const payload: IntentPayload = {
    id,
    action: opts.action,
    paramsHash: hashParams(opts.params),
    issuedAt: now,
    expiresAt: now + ttlMinutes * 60_000,
  }
  const sig = createHmac('sha256', secret)
    .update(`${payload.id}.${payload.action}.${payload.paramsHash}.${payload.expiresAt}`)
    .digest('hex')
  const file: IntentFile = { ...payload, sig }
  await writeFile(intentPath(id), JSON.stringify(file, null, 2), { mode: 0o600 })
  return { token: formatIntentToken({ id, sig, expiresAt: payload.expiresAt }), payload }
}

export interface VerifyOpts {
  token: string
  action: string
  params: unknown
}

export async function verifyAndConsumeIntent(opts: VerifyOpts): Promise<IntentPayload> {
  const parsed = parseIntentToken(opts.token)
  const path = intentPath(parsed.id)
  let file: IntentFile
  try {
    file = JSON.parse(await readFile(path, 'utf8')) as IntentFile
  } catch {
    throw new CliError(
      {
        code: 'intent_unknown',
        type: 'intent_invalid',
        message: 'unknown intent token',
        userMessage: `Intent ${parsed.id} not found. Mint one with \`v0 intent issue\`.`,
      },
      5,
    )
  }
  if (file.consumedAt) {
    throw new CliError(
      {
        code: 'intent_consumed',
        type: 'intent_invalid',
        message: 'intent already used',
        userMessage: `Intent ${parsed.id} was already consumed at ${new Date(file.consumedAt).toISOString()}.`,
      },
      5,
    )
  }
  const now = Date.now()
  if (file.expiresAt < now) {
    throw new CliError(
      {
        code: 'intent_expired',
        type: 'intent_invalid',
        message: 'intent expired',
        userMessage: `Intent ${parsed.id} expired at ${new Date(file.expiresAt).toISOString()}.`,
      },
      5,
    )
  }
  if (file.action !== opts.action) {
    throw new CliError(
      {
        code: 'intent_action_mismatch',
        type: 'intent_invalid',
        message: `intent action "${file.action}" does not match "${opts.action}"`,
        userMessage: `Intent was issued for \`${file.action}\`, not \`${opts.action}\`.`,
      },
      5,
    )
  }
  const expectedParamsHash = hashParams(opts.params)
  if (file.paramsHash !== expectedParamsHash) {
    throw new CliError(
      {
        code: 'intent_params_mismatch',
        type: 'intent_invalid',
        message: 'intent params do not match',
        userMessage: 'Intent was issued for different params. Mint a new token.',
      },
      5,
    )
  }
  const secret = await loadSecret()
  const expectedSig = createHmac('sha256', secret)
    .update(`${file.id}.${file.action}.${file.paramsHash}.${file.expiresAt}`)
    .digest('hex')
  if (expectedSig !== parsed.sig || expectedSig !== file.sig) {
    throw new CliError(
      {
        code: 'intent_sig_invalid',
        type: 'intent_invalid',
        message: 'intent signature invalid',
        userMessage: 'Intent signature does not verify. Do not trust this token.',
      },
      5,
    )
  }

  file.consumedAt = now
  await writeFile(path, JSON.stringify(file, null, 2), { mode: 0o600 })
  return file
}

export async function listIntents(): Promise<IntentFile[]> {
  try {
    const dir = intentsDir()
    const files = (await readdir(dir)).filter((f) => f.endsWith('.json'))
    const out: IntentFile[] = []
    for (const f of files) {
      try {
        const raw = await readFile(join(dir, f), 'utf8')
        out.push(JSON.parse(raw) as IntentFile)
      } catch {
        // skip unreadable
      }
    }
    return out.sort((a, b) => b.issuedAt - a.issuedAt)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}

export async function purgeExpired(): Promise<number> {
  const all = await listIntents()
  const now = Date.now()
  let purged = 0
  for (const entry of all) {
    if (entry.consumedAt || entry.expiresAt < now) {
      await unlink(intentPath(entry.id))
      purged += 1
    }
  }
  return purged
}
