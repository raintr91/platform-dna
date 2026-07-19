import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Idempotent merge of MCP `stdio` servers into a repo-local `.cursor/mcp.json`.
 * Only the named servers are ever touched; every other member/toolkit entry is
 * preserved byte-for-byte. Ownership is proven by hashing the exact entry we
 * wrote, so deinit removes a server only when it still matches what was wired.
 */

export interface McpStdioEntry {
  type?: 'stdio'
  command: string
  args: string[]
  env?: Record<string, string>
}

export interface McpMergeResult {
  file: string
  added: string[]
  updated: string[]
  unchanged: string[]
  /** sha256 of each written entry, keyed by server name — record in the manifest. */
  hashes: Record<string, string>
}

export interface McpRemoveResult {
  file: string
  removed: string[]
  preservedModified: string[]
  missing: string[]
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

export function mcpEntryHash(entry: unknown): string {
  return createHash('sha256').update(canonicalJson(entry)).digest('hex')
}

function readConfig(file: string): { data: Record<string, unknown>; existed: boolean } {
  if (!existsSync(file)) return { data: {}, existed: false }
  if (!lstatSync(file).isFile()) {
    throw new Error(`MCP config is not a regular file: ${file}`)
  }
  const raw = readFileSync(file, 'utf8').trim()
  if (!raw) return { data: {}, existed: true }
  const parsed = JSON.parse(raw)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`MCP config must be a JSON object: ${file}`)
  }
  return { data: parsed as Record<string, unknown>, existed: true }
}

function serverBag(data: Record<string, unknown>): Record<string, unknown> {
  const existing = data.mcpServers
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    return existing as Record<string, unknown>
  }
  return {}
}

export function mergeMcpServers(
  file: string,
  servers: Record<string, McpStdioEntry>,
): McpMergeResult {
  const { data } = readConfig(file)
  const bag = { ...serverBag(data) }
  const result: McpMergeResult = {
    file,
    added: [],
    updated: [],
    unchanged: [],
    hashes: {},
  }
  for (const [name, entry] of Object.entries(servers)) {
    const next = { type: 'stdio' as const, ...entry }
    result.hashes[name] = mcpEntryHash(next)
    if (!(name in bag)) result.added.push(name)
    else if (mcpEntryHash(bag[name]) === result.hashes[name]) {
      result.unchanged.push(name)
      continue
    } else result.updated.push(name)
    bag[name] = next
  }
  if (!result.added.length && !result.updated.length) return result

  data.mcpServers = bag
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`)
  return result
}

/**
 * Remove owned servers only when the current entry still hashes to the recorded
 * value. Member-modified entries are preserved and reported.
 */
export function removeMcpServers(
  file: string,
  expected: Record<string, string>,
  opts: { dryRun?: boolean } = {},
): McpRemoveResult {
  const result: McpRemoveResult = { file, removed: [], preservedModified: [], missing: [] }
  if (!existsSync(file)) {
    result.missing.push(...Object.keys(expected))
    return result
  }
  const { data } = readConfig(file)
  const bag = { ...serverBag(data) }
  let changed = false
  for (const [name, sha] of Object.entries(expected)) {
    if (!(name in bag)) {
      result.missing.push(name)
      continue
    }
    if (mcpEntryHash(bag[name]) !== sha) {
      result.preservedModified.push(name)
      continue
    }
    result.removed.push(name)
    if (!opts.dryRun) {
      delete bag[name]
      changed = true
    }
  }
  if (changed) {
    if (Object.keys(bag).length) data.mcpServers = bag
    else delete data.mcpServers
    writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`)
  }
  return result
}
