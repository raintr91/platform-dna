import { existsSync, readFileSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { mergeMcpServers, type McpMergeResult, type McpStdioEntry } from './mcp-config.js'
import type { InstallManifestMcp } from './harness.js'

/**
 * Cross-repo index routing: wire per-repo CodeGraph MCP servers so a skill/rule
 * can reach the *correct* repo's index instead of building one giant workspace
 * graph. Roots come only from the member-owned machine-local maps
 * (`platform-repos.local.json`, `legacy-repos.local.json`) — never from a scan
 * of the workspace parent.
 */

export type RepoSource = 'platform' | 'legacy'

export interface RepoRef {
  key: string
  root: string
  source: RepoSource
}

export interface CodegraphServerPlan {
  key: string
  name: string
  /** Normalized runtime root (or the raw value when it could not be resolved). */
  root: string
  source: RepoSource
  exists: boolean
  hasIndex: boolean
  /** Present when the entry is not wired: reason to show the member. */
  skipped?: string
}

export interface CodegraphPlan {
  wire: CodegraphServerPlan[]
  skipped: CodegraphServerPlan[]
  /** Repos that exist but have no `.codegraph/` yet, with the exact init hint. */
  needsIndex: Array<{ key: string; root: string; hint: string }>
}

const LOCAL_MAPS: Array<{ file: string; source: RepoSource }> = [
  { file: 'platform-repos.local.json', source: 'platform' },
  { file: 'legacy-repos.local.json', source: 'legacy' },
]

export function isWsl(): boolean {
  return Boolean(process.env.WSL_DISTRO_NAME) || /microsoft/i.test(os.release())
}

/**
 * Resolve a declared root to a path usable in the *current* runtime. In WSL a
 * `D:\...` value is rewritten to `/mnt/d/...`; on plain Linux a Windows-style
 * path fails closed (never written verbatim into a command run under WSL).
 */
export function normalizeRuntimePath(input: string): { path?: string; error?: string } {
  const raw = input.trim()
  if (!raw) return { error: 'empty root' }

  const drive = /^([A-Za-z]):[\\/](.*)$/.exec(raw)
  if (drive) {
    if (isWsl()) {
      const rest = drive[2].replace(/\\/g, '/').replace(/\/+/g, '/')
      return { path: path.posix.normalize(`/mnt/${drive[1].toLowerCase()}/${rest}`) }
    }
    if (process.platform === 'win32') return { path: path.win32.normalize(raw) }
    return { error: `Windows path not usable in this runtime: ${raw}` }
  }

  if (raw.includes('\\') && process.platform !== 'win32') {
    return { error: `backslash path not usable in this runtime: ${raw}` }
  }
  return { path: raw }
}

function extractProjects(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
  const record = data as Record<string, unknown>
  const projects = record.projects
  if (projects && typeof projects === 'object' && !Array.isArray(projects)) {
    return projects as Record<string, unknown>
  }
  return record
}

export function readRepoRefs(root: string): RepoRef[] {
  const base = path.resolve(root)
  // Platform map is listed first so duplicate keys prefer platform (legacy-only
  // keys typically use the `legacy-*` prefix and appear only in the legacy map).
  const byKey = new Map<string, RepoRef>()
  for (const { file, source } of LOCAL_MAPS) {
    const mapPath = path.join(base, file)
    if (!existsSync(mapPath)) continue
    let data: unknown
    try {
      data = JSON.parse(readFileSync(mapPath, 'utf8'))
    } catch {
      continue
    }
    for (const [key, value] of Object.entries(extractProjects(data))) {
      if (byKey.has(key)) continue
      const rootValue = (value as { root?: unknown } | null)?.root
      if (typeof rootValue === 'string' && rootValue.trim()) {
        byKey.set(key, { key, root: rootValue.trim(), source })
      }
    }
  }
  return [...byKey.values()]
}

export function codegraphCommand(): string {
  return process.env.PLATFORM_DNA_CODEGRAPH_COMMAND?.trim() || 'codegraph'
}

export function codegraphServerEntry(root: string): McpStdioEntry {
  return {
    type: 'stdio',
    command: codegraphCommand(),
    args: ['mcp', '--project-root', root],
  }
}

/**
 * Build the wiring plan. `selfRoot` (the repo being initialized) is excluded by
 * default so cross-index only targets *other* repos; `filterKeys` narrows the
 * set further so init never wires every checkout.
 */
export function planCodegraphServers(opts: {
  root: string
  filterKeys?: string[]
  includeSelf?: boolean
  refs?: RepoRef[]
}): CodegraphPlan {
  const selfRoot = path.resolve(opts.root)
  const refs = opts.refs ?? readRepoRefs(selfRoot)
  const filter = opts.filterKeys?.length ? new Set(opts.filterKeys) : undefined

  const plan: CodegraphPlan = { wire: [], skipped: [], needsIndex: [] }
  const byName = new Map<string, CodegraphServerPlan>()

  for (const ref of refs) {
    if (filter && !filter.has(ref.key)) continue
    const name = `codegraph-${ref.key}`
    const normalized = normalizeRuntimePath(ref.root)

    const server: CodegraphServerPlan = {
      key: ref.key,
      name,
      root: normalized.path ?? ref.root,
      source: ref.source,
      exists: false,
      hasIndex: false,
    }

    if (normalized.error) {
      server.skipped = normalized.error
      register(server)
      continue
    }

    const abs = path.resolve(normalized.path!)
    server.root = abs
    if (!opts.includeSelf && abs === selfRoot) {
      server.skipped = 'current repo (wire its own index via `codegraph init` locally)'
      register(server)
      continue
    }

    server.exists = existsSync(abs) && statSync(abs).isDirectory()
    server.hasIndex = server.exists && existsSync(path.join(abs, '.codegraph'))
    if (!server.exists) {
      server.skipped = `root not found: ${abs}`
      register(server)
      continue
    }

    const existing = byName.get(name)
    if (existing && existing.root !== abs) {
      server.skipped = `name collision with ${existing.source} entry for "${ref.key}"`
      plan.skipped.push(server)
      continue
    }

    if (!server.hasIndex) {
      // Contract: only wire checkouts that already have `.codegraph/`. A repo
      // that exists but is not indexed is never merged into mcp.json (a server
      // pointing at a missing index would just fail); surface the exact init
      // hint via needsIndex so status can nag without wiring anything.
      plan.needsIndex.push({
        key: ref.key,
        root: abs,
        hint: `cd ${abs} && ${codegraphCommand()} init`,
      })
      continue
    }
    register(server)
  }

  return plan

  function register(server: CodegraphServerPlan): void {
    if (server.skipped) {
      plan.skipped.push(server)
      return
    }
    // Only indexed repos reach here; wire exactly one server per name.
    byName.set(server.name, server)
    plan.wire.push(server)
  }
}

export const CODEGRAPH_MCP_FILE = '.cursor/mcp.json'

export interface WireCodegraphResult {
  plan: CodegraphPlan
  mcpFile: string
  merge?: McpMergeResult
  manifestMcp?: InstallManifestMcp
}

/**
 * Plan and (unless dry-run) merge the per-repo CodeGraph servers into the repo's
 * local `.cursor/mcp.json`. Returns the manifest fragment describing exactly the
 * servers we own, so status/deinit can verify and unwire them precisely.
 */
export function wireCodegraph(opts: {
  root: string
  filterKeys?: string[]
  includeSelf?: boolean
  dryRun?: boolean
  refs?: RepoRef[]
}): WireCodegraphResult {
  const plan = planCodegraphServers(opts)
  const mcpFile = CODEGRAPH_MCP_FILE
  if (!plan.wire.length || opts.dryRun) return { plan, mcpFile }

  const file = path.join(path.resolve(opts.root), mcpFile)
  const servers: Record<string, McpStdioEntry> = Object.fromEntries(
    plan.wire.map((server) => [server.name, codegraphServerEntry(server.root)]),
  )
  const merge = mergeMcpServers(file, servers)
  const manifestMcp: InstallManifestMcp = {
    file: mcpFile,
    servers: Object.fromEntries(
      Object.entries(merge.hashes).map(([name, sha256]) => [name, { sha256 }]),
    ),
  }
  return { plan, mcpFile, merge, manifestMcp }
}
