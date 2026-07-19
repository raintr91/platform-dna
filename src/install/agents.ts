import { existsSync, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const agentIds = [
  'claude',
  'cursor',
  'codex',
  'opencode',
  'hermes',
  'gemini',
  'antigravity',
  'kiro',
  'kilo',
] as const

export type AgentId = (typeof agentIds)[number]

export const agentNames: Record<AgentId, string> = {
  claude: 'Claude Code',
  cursor: 'Cursor',
  codex: 'Codex CLI',
  opencode: 'opencode',
  hermes: 'Hermes Agent',
  gemini: 'Gemini CLI',
  antigravity: 'Antigravity IDE',
  kiro: 'Kiro',
  kilo: 'Kilo Code',
}

const agentAliases: Record<string, AgentId> = {
  claude: 'claude',
  cursor: 'cursor',
  codex: 'codex',
  opencode: 'opencode',
  hermes: 'hermes',
  gemini: 'gemini',
  antigravity: 'antigravity',
  agy: 'antigravity',
  'google-antigravity': 'antigravity',
  kiro: 'kiro',
  kilo: 'kilo',
}

function xdgConfigHome(): string {
  return process.env.XDG_CONFIG_HOME?.trim() || path.join(os.homedir(), '.config')
}

function windowsUserHas(relative: string): boolean {
  const usersRoot = '/mnt/c/Users'
  if (!existsSync(usersRoot)) return false
  try {
    return readdirSync(usersRoot).some((name) => {
      if (name.startsWith('.') || ['Public', 'Default', 'All Users'].includes(name)) return false
      return existsSync(path.join(usersRoot, name, relative))
    })
  } catch {
    return false
  }
}

export function detectAgents(cwd = process.cwd()): AgentId[] {
  const home = os.homedir()
  const found: AgentId[] = []
  const add = (id: AgentId, detected: boolean) => {
    if (detected) found.push(id)
  }

  add(
    'claude',
    existsSync(path.join(home, '.claude.json')) ||
      existsSync(path.join(home, '.claude')) ||
      existsSync(path.join(cwd, '.claude.json')) ||
      existsSync(path.join(cwd, '.mcp.json')),
  )
  add(
    'cursor',
    existsSync(path.join(home, '.cursor')) ||
      existsSync(path.join(cwd, '.cursor')) ||
      windowsUserHas('.cursor'),
  )
  add('codex', existsSync(path.join(home, '.codex')) || existsSync(path.join(cwd, '.codex')))
  add(
    'opencode',
    existsSync(path.join(xdgConfigHome(), 'opencode')) ||
      existsSync(path.join(cwd, 'opencode.jsonc')) ||
      existsSync(path.join(cwd, 'opencode.json')),
  )
  const hermesHome = process.env.HERMES_HOME
    ? path.resolve(process.env.HERMES_HOME)
    : path.join(home, '.hermes')
  add('hermes', existsSync(hermesHome))
  add(
    'gemini',
    existsSync(path.join(home, '.gemini')) ||
      existsSync(path.join(cwd, '.gemini')) ||
      existsSync(path.join(cwd, 'GEMINI.md')),
  )
  add(
    'antigravity',
    existsSync(path.join(home, '.gemini', 'antigravity')) ||
      existsSync(path.join(home, '.gemini', 'config')) ||
      existsSync(path.join(home, '.antigravity-ide-server')) ||
      existsSync(path.join(cwd, '.gemini', 'antigravity')) ||
      windowsUserHas(path.join('.gemini', 'config')),
  )
  add('kiro', existsSync(path.join(home, '.kiro')) || existsSync(path.join(cwd, '.kiro')))
  add(
    'kilo',
    existsSync(path.join(home, '.kilocode')) ||
      existsSync(path.join(cwd, '.kilocode')) ||
      existsSync(path.join(cwd, '.kilo')),
  )
  return found
}

export function parseAgentTargets(
  raw: string | undefined,
  detected: AgentId[],
  fallback: AgentId[] = ['cursor'],
): AgentId[] {
  const value = (raw ?? '').trim().toLowerCase()
  if (!value) return [...fallback]
  if (value === 'auto') return detected.length ? [...detected] : [...fallback]
  if (value === 'all') return [...agentIds]
  if (value === 'none') return []

  const targets: AgentId[] = []
  for (const part of value.split(/[,\s]+/).filter(Boolean)) {
    const id = agentAliases[part]
    if (!id) {
      throw new Error(
        `Unknown target "${part}". Known: ${agentIds.join(', ')}, agy, auto, all, none`,
      )
    }
    if (!targets.includes(id)) targets.push(id)
  }
  return targets
}
