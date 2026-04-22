import type { TrustLevel } from '../audit/jsonl.ts'

// Canonical trust classification per shaping.md.
// Add new commands here; everything not mapped defaults to T1 to force an explicit decision.
const TRUST_MAP: Record<string, TrustLevel> = {
  // T0: reads / introspection / health
  'auth status': 'T0',
  'auth whoami': 'T0',
  'user get': 'T0',
  'user plan': 'T0',
  'user billing': 'T0',
  'user scopes': 'T0',
  'rate-limits': 'T0',
  doctor: 'T0',
  schema: 'T0',
  'audit tail': 'T0',
  'project list': 'T0',
  'project show': 'T0',
  'chat list': 'T0',
  'chat show': 'T0',
  'chat pending': 'T0',
  'chat status': 'T0',
  'chat watch': 'T0',
  'chat wait': 'T0',
  'msg list': 'T0',
  'msg show': 'T0',
  'version list': 'T0',
  'version show': 'T0',
  'version download': 'T0',
  'deploy list': 'T0',
  'deploy show': 'T0',
  'deploy logs': 'T0',
  'deploy errors': 'T0',
  'hook list': 'T0',
  'hook show': 'T0',
  'integrations vercel list': 'T0',
  'mcp-server list': 'T0',
  'report usage': 'T0',
  'report activity': 'T0',

  // T1: cheap writes (audit only)
  'chat create': 'T1',
  'chat init': 'T1',
  'chat update': 'T1',
  'chat favorite': 'T1',
  'chat fork': 'T1',
  'msg send': 'T1',
  'msg resume': 'T1',
  'msg stop': 'T1',
  'version update': 'T1',
  'project create': 'T1',
  'project update': 'T1',
  'project assign': 'T1',
  'hook create': 'T1',
  'mcp-server create': 'T1',
  'integrations vercel link': 'T1',
  'env list': 'T0',
  'env get': 'T0',
  'env set': 'T1', // dynamically upgraded to T2 in handler via classifyEnvSet()
  'env update': 'T1',
  'env push': 'T1',
  // `env pull` reveals secrets to disk — T2 even though it's a read
  'env pull': 'T2',
  'env delete': 'T2',
  'intent issue': 'T1',
  'intent list': 'T0',
  'intent purge': 'T1',
  init: 'T1',

  // T2: confirm
  'deploy create': 'T2',
  'deploy batch': 'T2',
  'chat delete': 'T2',
  'hook update': 'T2',
  'mcp-server update': 'T2',
  'version files-delete': 'T2',
  'project delete': 'T2', // escalates to T3 in handler when --delete-all-chats
  // `project delete` (no cascade) is T2 — see classifyProjectDelete()

  // T3: killswitch (intent token)
  // `project delete --delete-all-chats`, `env delete` (bulk), `deploy delete`, `hook delete`, `mcp-server delete`
  'deploy delete': 'T3',
  'hook delete': 'T3',
  'mcp-server delete': 'T3',
}

export function classifyCommand(commandPath: string[]): TrustLevel {
  const key = commandPath.join(' ')
  return TRUST_MAP[key] ?? 'T1'
}

export function classifyProjectDelete(deleteAllChats: boolean): TrustLevel {
  return deleteAllChats ? 'T3' : 'T2'
}

export function classifyEnvSet(keys: string[], secretPatterns: string[]): TrustLevel {
  const matchers = secretPatterns.map(toRegex)
  const hasSecret = keys.some((k) => matchers.some((re) => re.test(k)))
  return hasSecret ? 'T2' : 'T1'
}

export function classifyEnvDelete(count: number): TrustLevel {
  return count > 1 ? 'T3' : 'T2'
}

function toRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`)
}
