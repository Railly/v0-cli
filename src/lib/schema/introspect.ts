import bundled from './openapi.json' with { type: 'json' }

interface OpenApiPaths {
  [path: string]: {
    [method: string]: {
      operationId?: string
      summary?: string
      description?: string
      requestBody?: unknown
      parameters?: unknown[]
      responses?: Record<string, unknown>
    }
  }
}

interface OpenApiDoc {
  openapi?: string
  info?: { title?: string; version?: string }
  paths?: OpenApiPaths
  components?: { schemas?: Record<string, unknown> }
}

async function loadOpenApi(): Promise<OpenApiDoc> {
  return bundled as OpenApiDoc
}

export interface OperationInfo {
  operationId: string
  path: string
  method: string
  summary?: string
  description?: string
  requestBody?: unknown
  parameters?: unknown[]
  responses?: Record<string, unknown>
}

export async function findOperation(operationId: string): Promise<OperationInfo | null> {
  const doc = await loadOpenApi()
  const paths = doc.paths ?? {}
  for (const [p, methods] of Object.entries(paths)) {
    for (const [method, op] of Object.entries(methods)) {
      if (op.operationId === operationId) {
        return {
          operationId,
          path: p,
          method: method.toUpperCase(),
          ...(op.summary !== undefined ? { summary: op.summary } : {}),
          ...(op.description !== undefined ? { description: op.description } : {}),
          ...(op.requestBody !== undefined ? { requestBody: op.requestBody } : {}),
          ...(op.parameters !== undefined ? { parameters: op.parameters } : {}),
          ...(op.responses !== undefined ? { responses: op.responses } : {}),
        }
      }
    }
  }
  return null
}

export async function listOperations(): Promise<OperationInfo[]> {
  const doc = await loadOpenApi()
  const paths = doc.paths ?? {}
  const out: OperationInfo[] = []
  for (const [p, methods] of Object.entries(paths)) {
    for (const [method, op] of Object.entries(methods)) {
      if (!op.operationId) continue
      out.push({
        operationId: op.operationId,
        path: p,
        method: method.toUpperCase(),
        ...(op.summary !== undefined ? { summary: op.summary } : {}),
      })
    }
  }
  return out.sort((a, b) => a.operationId.localeCompare(b.operationId))
}

export async function resolveSchema(ref: string): Promise<unknown> {
  const doc = await loadOpenApi()
  if (!ref.startsWith('#/')) return null
  const parts = ref.slice(2).split('/')
  let node: unknown = doc
  for (const part of parts) {
    if (node && typeof node === 'object' && part in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[part]
    } else {
      return null
    }
  }
  return node
}
