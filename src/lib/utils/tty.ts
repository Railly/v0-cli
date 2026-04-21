export function isStdoutTTY(): boolean {
  return !!process.stdout.isTTY
}

export function isStdinTTY(): boolean {
  return !!process.stdin.isTTY
}

export function detectDefaultMode(): 'human' | 'json' {
  return isStdoutTTY() ? 'human' : 'json'
}

export function detectNoInput(explicit?: boolean): boolean {
  if (explicit === true) return true
  if (explicit === false) return false
  return !isStdinTTY()
}
