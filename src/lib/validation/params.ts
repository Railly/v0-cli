import { findOperation } from '../schema/introspect.ts'
import { CliError } from '../utils/errors.ts'

export function parseParamsJson(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new CliError(
        {
          code: 'validation_error',
          type: 'validation_error',
          message: '--params must be a JSON object',
          userMessage: 'Pass --params as a JSON object, e.g. --params \'{"message":"..."}\'',
        },
        2,
      )
    }
    return parsed as Record<string, unknown>
  } catch (err) {
    if (err instanceof CliError) throw err
    throw new CliError(
      {
        code: 'validation_error',
        type: 'validation_error',
        message: `invalid JSON in --params: ${(err as Error).message}`,
        userMessage: 'Could not parse --params as JSON. Check quoting and escaping.',
      },
      2,
    )
  }
}

export function mergeParams<T extends Record<string, unknown>>(
  sugar: T,
  params: Record<string, unknown>,
  warnOnConflict?: (key: string) => void,
): T & Record<string, unknown> {
  const out: Record<string, unknown> = { ...sugar }
  for (const [k, v] of Object.entries(params)) {
    if (k in out && out[k] !== undefined && out[k] !== v && warnOnConflict) {
      warnOnConflict(k)
    }
    out[k] = v
  }
  return out as T & Record<string, unknown>
}

interface SchemaRef {
  type?: string
  properties?: Record<string, { type?: string; enum?: unknown[]; description?: string }>
  required?: string[]
  additionalProperties?: boolean | Record<string, unknown>
  allOf?: SchemaRef[]
  anyOf?: SchemaRef[]
  oneOf?: SchemaRef[]
}

function extractBodySchema(requestBody: unknown): SchemaRef | null {
  const body = requestBody as { content?: Record<string, { schema?: SchemaRef }> } | undefined
  return body?.content?.['application/json']?.schema ?? null
}

function gatherRequired(schema: SchemaRef | null): string[] {
  if (!schema) return []
  const req = new Set<string>(schema.required ?? [])
  for (const nested of schema.allOf ?? []) {
    for (const k of gatherRequired(nested)) req.add(k)
  }
  return [...req]
}

function gatherProperties(
  schema: SchemaRef | null,
): Record<string, { type?: string; enum?: unknown[] }> {
  if (!schema) return {}
  const out: Record<string, { type?: string; enum?: unknown[] }> = { ...(schema.properties ?? {}) }
  for (const nested of schema.allOf ?? []) {
    Object.assign(out, gatherProperties(nested))
  }
  return out
}

export interface ValidateOpts {
  operationId: string
  body: Record<string, unknown>
  strict?: boolean
}

export async function validateBody(opts: ValidateOpts): Promise<void> {
  const op = await findOperation(opts.operationId)
  if (!op) {
    throw new CliError(
      {
        code: 'validation_error',
        type: 'validation_error',
        message: `unknown operationId ${opts.operationId}`,
        userMessage: `Could not find OpenAPI entry for ${opts.operationId}. Run \`v0 schema\` to list operations.`,
      },
      2,
    )
  }
  const schema = extractBodySchema(op.requestBody)
  if (!schema) return
  const required = gatherRequired(schema)
  const missing = required.filter((k) => !(k in opts.body))
  if (missing.length) {
    throw new CliError(
      {
        code: 'validation_error',
        type: 'validation_error',
        message: `missing required fields: ${missing.join(', ')}`,
        userMessage: `Missing required fields for ${opts.operationId}: ${missing.join(', ')}. Run \`v0 schema ${opts.operationId}\` for the full shape.`,
      },
      2,
    )
  }
  if (opts.strict) {
    const props = gatherProperties(schema)
    const unknown = Object.keys(opts.body).filter((k) => !(k in props))
    if (unknown.length) {
      throw new CliError(
        {
          code: 'validation_error',
          type: 'validation_error',
          message: `unknown fields: ${unknown.join(', ')}`,
          userMessage: `Unknown fields for ${opts.operationId}: ${unknown.join(', ')}. Remove them or check the schema.`,
        },
        2,
      )
    }
  }
}
