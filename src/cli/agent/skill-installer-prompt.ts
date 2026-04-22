// cligentic block: skill-installer-prompt
//
// Post-init hook for CLIs that ship a companion agent skill. Asks the
// user "want the Claude Code / Cursor / MCP-aware skill?" and, on yes,
// spawns a package manager command with inherited stdio so the user
// sees the real output.
//
// Design rules:
//   1. Default answer is `true`. Most users who typed `myapp init` will
//      want the skill; the opt-in tax should be minimal.
//   2. stdio is inherited. The user sees the package manager's live
//      progress, errors, and prompts. No wrapping, no filtering.
//   3. Never throws on installer failure. Returns { installed:false,
//      error:"..." } so the caller can surface a retry hint.
//   4. Never throws on cancel. Returns { installed:false, cancelled:true }.
//   5. Works with any installer command, not just `npx`. Pass the full
//      argv array (e.g. ["pnpm","dlx","skills","add","owner/repo"]).
//
// Usage:
//   import { offerSkillInstall } from "./agent/skill-installer-prompt";
//
//   const outcome = await offerSkillInstall({
//     skillSlug: "Railly/v0-cli",
//     command: ["npx", "-y", "skills", "add", "Railly/v0-cli"],
//     promptMessage: "Install the agent skill for Claude Code / Cursor?",
//   });
//
//   if (outcome.installed) {
//     // skill is live, chain next step
//   } else if (outcome.cancelled) {
//     // user said no or pressed esc — chain without skill
//   } else {
//     // installer failed — surface outcome.error, offer retry
//   }
//
// Depends on:
//   - @clack/prompts (confirm, isCancel, log)

import { spawn } from 'node:child_process'
import * as p from '@clack/prompts'

export type SkillInstallerPromptOptions = {
  /**
   * Label for the skill in logs and hints. Typically the repo slug
   * ("owner/repo") or a display name ("Agent skill for v0-cli").
   */
  skillSlug: string
  /**
   * Full argv for the installer. First element is the program name,
   * the rest are arguments. Defaults to ["npx","-y","skills","add",skillSlug].
   */
  command?: string[]
  /** Prompt shown to the user. Optional; has a sensible default. */
  promptMessage?: string
  /** Whether the default selection is Yes. Defaults to true. */
  initialValue?: boolean
  /** Skip the confirm prompt entirely. The installer runs unconditionally. */
  autoYes?: boolean
  /** Don't offer the install at all. Returns {installed:false,skipped:true}. */
  skip?: boolean
}

export type SkillInstallerOutcome =
  | { installed: true }
  | { installed: false; cancelled: true }
  | { installed: false; skipped: true }
  | { installed: false; error: string }

/**
 * Prompts the user (unless autoYes / skip), runs the installer with
 * inherited stdio, returns a discriminated outcome. Never throws.
 */
export async function offerSkillInstall(
  opts: SkillInstallerPromptOptions,
): Promise<SkillInstallerOutcome> {
  if (opts.skip) return { installed: false, skipped: true }

  if (!opts.autoYes) {
    const answer = await p.confirm({
      message:
        opts.promptMessage ??
        `Install ${opts.skillSlug} as an agent skill (Claude Code / Cursor / MCP-aware agents)?`,
      initialValue: opts.initialValue ?? true,
    })
    if (p.isCancel(answer) || !answer) {
      p.log.info('Skipped skill install.')
      return { installed: false, cancelled: true }
    }
  }

  const argv = opts.command ?? ['npx', '-y', 'skills', 'add', opts.skillSlug]
  const [program, ...rest] = argv
  if (!program) {
    return { installed: false, error: 'empty command array' }
  }

  p.log.step(`Running: ${argv.join(' ')}`)

  const result = await new Promise<SkillInstallerOutcome>((resolve) => {
    const child = spawn(program, rest, { stdio: 'inherit' })
    child.on('exit', (code) => {
      if (code === 0) resolve({ installed: true })
      else resolve({ installed: false, error: `${program} exited with code ${code ?? '?'}` })
    })
    child.on('error', (err) => {
      resolve({ installed: false, error: err.message })
    })
  })

  if (result.installed) {
    p.log.success(`Installed ${opts.skillSlug}.`)
  } else if ('error' in result) {
    p.log.warn(`Skill install failed (${result.error}). Retry with: ${argv.join(' ')}`)
  }
  return result
}
