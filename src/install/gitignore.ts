import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Shared `.gitignore` contract for every toolkit `init`.
 *
 * Destination repos never hand-maintain toolkit ignore blocks. Each toolkit
 * merges only the entries its own init actually generated, using the helpers
 * here so the semantics (idempotent, EOL-preserving, equivalence-aware) stay
 * identical across Hubdocs, Testkit, ArtifactGraph, Bundlekit, Processkit and
 * Codegenkit.
 */

export interface OwnedGitignoreEntry {
  pattern: string
  /**
   * Shared entries may be relied on by other toolkits (for example `.cursor/`
   * or `.cursor/mcp.json`). They are ensured on init but kept on deinit so a
   * single toolkit removal never breaks another toolkit still using them.
   */
  shared?: boolean
}

export interface EnsureGitignoreResult {
  file: string
  /** Entries newly written by this call (trimmed source form). */
  added: string[]
  changed: boolean
}

export interface RemoveGitignoreResult {
  file?: string
  removed: string[]
  changed: boolean
}

/**
 * Canonical form so `.cursor/`, `/.cursor/` and `.cursor` compare equal.
 * Preserves negation (`!`) and glob text; only leading `./`, leading `/` and
 * trailing `/` are normalized because git treats those as equivalent anchors.
 */
export function canonicalGitignorePattern(pattern: string): string {
  let value = pattern.trim()
  if (!value) return ''
  let negated = false
  if (value.startsWith('!')) {
    negated = true
    value = value.slice(1)
  }
  value = value.replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, '')
  return `${negated ? '!' : ''}${value}`
}

function detectEol(content: string): '\r\n' | '\n' {
  return /\r\n/.test(content) ? '\r\n' : '\n'
}

function presentPatterns(content: string): Set<string> {
  const set = new Set<string>()
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    set.add(canonicalGitignorePattern(line))
  }
  return set
}

function gitignorePath(root: string): string {
  const file = path.join(path.resolve(root), '.gitignore')
  if (existsSync(file) && !lstatSync(file).isFile()) {
    throw new Error(`.gitignore is not a regular file: ${file}`)
  }
  return file
}

/**
 * Ensure every pattern is present exactly once. Creates the file when missing,
 * preserves existing member content and the file's dominant EOL, and never
 * duplicates an equivalent pattern.
 */
export function ensureGitignoreEntries(root: string, patterns: string[]): EnsureGitignoreResult {
  const file = gitignorePath(root)
  const existed = existsSync(file)
  const content = existed ? readFileSync(file, 'utf8') : ''
  const eol = existed ? detectEol(content) : '\n'
  const present = presentPatterns(content)

  const seen = new Set<string>()
  const added: string[] = []
  for (const pattern of patterns) {
    const canonical = canonicalGitignorePattern(pattern)
    if (!canonical || present.has(canonical) || seen.has(canonical)) continue
    seen.add(canonical)
    added.push(pattern.trim())
  }
  if (!added.length) return { file, added: [], changed: false }

  const prefix = content.length > 0 && !/\r?\n$/.test(content) ? eol : ''
  writeFileSync(file, `${content}${prefix}${added.join(eol)}${eol}`)
  return { file, added, changed: true }
}

/**
 * Remove the given patterns (matched by equivalence) while preserving unrelated
 * member lines and the file's dominant EOL. Missing files/patterns are a no-op.
 */
export function removeGitignoreEntries(root: string, patterns: string[]): RemoveGitignoreResult {
  const file = gitignorePath(root)
  if (!existsSync(file)) return { removed: [], changed: false }

  const content = readFileSync(file, 'utf8')
  const eol = detectEol(content)
  const drop = new Set(patterns.map(canonicalGitignorePattern).filter(Boolean))
  const hadTrailingNewline = /\r?\n$/.test(content)

  const removed: string[] = []
  const kept: string[] = []
  for (const raw of content.split(/\r?\n/)) {
    const trimmed = raw.trim()
    const canonical = trimmed && !trimmed.startsWith('#') ? canonicalGitignorePattern(trimmed) : ''
    if (canonical && drop.has(canonical)) {
      removed.push(trimmed)
      continue
    }
    kept.push(raw)
  }
  if (!removed.length) return { file, removed: [], changed: false }

  // split on the final empty element produced by a trailing newline
  if (hadTrailingNewline && kept[kept.length - 1] === '') kept.pop()
  const body = kept.join(eol)
  writeFileSync(file, body.length && hadTrailingNewline ? `${body}${eol}` : body)
  return { file, removed, changed: true }
}
