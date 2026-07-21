import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { ensureGitignoreEntries, type OwnedGitignoreEntry } from './gitignore.js'

/**
 * Machine-local checkout maps (create-if-missing only).
 *
 * SSOT for every toolkit `init`: Docskit / Processkit… import this
 * helper so install order never gates cross-repo maps. Never seeds portable
 * `platform-repos.json` / `legacy-repos.json`.
 */

export const PLATFORM_LOCAL_MAP = 'platform-repos.local.json'
export const LEGACY_LOCAL_MAP = 'legacy-repos.local.json'

export const LOCAL_MAP_FILES = [PLATFORM_LOCAL_MAP, LEGACY_LOCAL_MAP] as const

const PLATFORM_SCHEMA =
  'https://github.com/raintr91/platform-dna/blob/main/templates/schemas/platform-repos.schema.json'
const LEGACY_SCHEMA =
  'https://github.com/raintr91/docskit/blob/main/templates/schemas/legacy-repos.schema.json'

export type RepoMapKind = 'platform' | 'legacy'

export interface EnsureLocalRepoMapsResult {
  created: string[]
  skipped: string[]
  /** Shared gitignore entries ensured for both local maps. */
  gitignoreEntries: OwnedGitignoreEntry[]
  gitignoreAdded: string[]
}

export interface LocalMapStatus {
  file: string
  exists: boolean
  /** True when the file is missing or `projects` has no keys. */
  empty: boolean
  projectCount: number
}

function skeleton(schema: string): string {
  return `${JSON.stringify({ $schema: schema, projects: {} }, null, 2)}\n`
}

function projectCount(file: string): number {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8')) as { projects?: unknown }
    const projects = data?.projects
    if (projects && typeof projects === 'object' && !Array.isArray(projects)) {
      return Object.keys(projects as Record<string, unknown>).length
    }
  } catch {
    // Unreadable / invalid JSON → treat as empty so status nags.
  }
  return 0
}

/**
 * Route a system id to the correct machine-local map.
 * `legacy-*` → legacy map; everything else → platform.
 */
export function mapKindForSystemId(systemId: string): RepoMapKind {
  const id = systemId.trim()
  if (/^legacy-/i.test(id)) return 'legacy'
  return 'platform'
}

export function localMapFileForSystemId(systemId: string): (typeof LOCAL_MAP_FILES)[number] {
  return mapKindForSystemId(systemId) === 'legacy' ? LEGACY_LOCAL_MAP : PLATFORM_LOCAL_MAP
}

/**
 * Create `platform-repos.local.json` and `legacy-repos.local.json` when missing.
 * Existing files are never overwritten, merged, or normalized (member content
 * and CRLF are preserved by not touching the file).
 *
 * Both ignore patterns are **shared**: any toolkit may ensure them; deinit of
 * one toolkit must not strip the lines while others still rely on the maps.
 */
export function ensureLocalRepoMaps(root: string): EnsureLocalRepoMapsResult {
  const base = path.resolve(root)
  const created: string[] = []
  const skipped: string[] = []

  const specs: Array<{ file: string; body: string }> = [
    { file: PLATFORM_LOCAL_MAP, body: skeleton(PLATFORM_SCHEMA) },
    { file: LEGACY_LOCAL_MAP, body: skeleton(LEGACY_SCHEMA) },
  ]

  for (const { file, body } of specs) {
    const absolute = path.join(base, file)
    if (existsSync(absolute)) {
      skipped.push(file)
      continue
    }
    writeFileSync(absolute, body)
    created.push(file)
  }

  const gitignore = ensureGitignoreEntries(base, [...LOCAL_MAP_FILES])
  const gitignoreEntries: OwnedGitignoreEntry[] = LOCAL_MAP_FILES.map((pattern) => ({
    pattern,
    shared: true,
  }))

  return {
    created,
    skipped,
    gitignoreEntries,
    gitignoreAdded: gitignore.added,
  }
}

/** Status slice for toolkit `status` — missing/empty maps for cross-repo. */
export function localMapsStatus(root: string): LocalMapStatus[] {
  const base = path.resolve(root)
  return LOCAL_MAP_FILES.map((file) => {
    const absolute = path.join(base, file)
    const exists = existsSync(absolute)
    const count = exists ? projectCount(absolute) : 0
    return {
      file,
      exists,
      empty: !exists || count === 0,
      projectCount: count,
    }
  })
}
