import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  unlinkSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import {
  packageRoot,
  packageVersion,
  type ProfileType,
} from '../config/project-root.js'
import type { SeededProjectMap } from './maps.js'
import { forgetInstall, recordInstall } from './ledger.js'
import {
  canonicalGitignorePattern,
  removeGitignoreEntries,
  type OwnedGitignoreEntry,
} from './gitignore.js'
import { mcpEntryHash, removeMcpServers } from './mcp-config.js'
import {
  CONFIGURE_REPO_MAPS_REL,
  isVendorThinConfigureRepoMaps,
} from './configure-repo-maps.js'
import { localMapsStatus, type LocalMapStatus } from './local-maps.js'

export interface InstallManifestFile {
  source: string
  sha256: string
  state: 'active' | 'stale'
}

export interface InstallManifestMcp {
  file: string
  servers: Record<string, { sha256: string }>
}

export interface InstallManifest {
  schemaVersion: 1
  package: '@platform/platform-dna'
  packageVersion: string
  type: ProfileType
  harnessApi: 1
  files: Record<string, InstallManifestFile>
  maps?: Record<string, { sha256: string }>
  /** Exact `.gitignore` entries Platform DNA ensured, with shared-ownership. */
  gitignore?: OwnedGitignoreEntry[]
  /** Owned MCP server entries, so `status` can verify and `deinit` can unwire. */
  mcp?: InstallManifestMcp
}

export interface HarnessFileStatus extends InstallManifestFile {
  path: string
  status: 'unmodified' | 'modified' | 'missing'
  prunable: boolean
}

export interface GitignoreEntryStatus {
  pattern: string
  shared: boolean
  present: boolean
}

export interface McpServerStatus {
  name: string
  status: 'unmodified' | 'modified' | 'missing'
}

export interface HarnessStatus {
  manifestPath: string
  type: ProfileType
  packageVersion: string
  files: HarnessFileStatus[]
  gitignore: GitignoreEntryStatus[]
  mcp: McpServerStatus[]
  /** Read-only cross-repo map nag slice; empty maps do not fail status. */
  localMaps: LocalMapStatus[]
}

export interface PruneHarnessResult {
  dryRun: boolean
  planned: string[]
  deleted: string[]
  skipped: HarnessFileStatus[]
}

export interface UninstallHarnessResult {
  dryRun: boolean
  wouldDelete: string[]
  deleted: string[]
  preservedModified: string[]
  missing: string[]
  manifestRemoved: boolean
}

function hash(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function walk(root: string, opts?: { skipNames?: Set<string> }): string[] {
  if (!existsSync(root)) return []
  const skip = opts?.skipNames ?? new Set()
  return readdirSync(root).flatMap((name) => {
    if (skip.has(name)) return []
    const file = path.join(root, name)
    return statSync(file).isDirectory() ? walk(file, opts) : [file]
  })
}

/** Map harness source path → installed .cursor relative path. */
export function harnessSourceToTarget(source: string): string {
  const parts = source.split('/')
  if (parts[0] !== 'harness') {
    throw new Error(`Invalid Platform DNA harness source: ${source}`)
  }
  // harness/fe/adapters/<adapter>/skills/... → .cursor/skills/...
  if (
    parts[2] === 'adapters' &&
    parts[3] &&
    (parts[1] === 'fe' || parts[1] === 'be' || parts[1] === 'docs' || parts[1] === 'tests')
  ) {
    return `.cursor/${parts.slice(4).join('/')}`
  }
  // harness/common|docs|fe|be|tests/<rel> → .cursor/<rel>
  return `.cursor/${parts.slice(2).join('/')}`
}

function manifestFile(root: string): string {
  return path.join(root, '.platform-dna', 'install-manifest.json')
}

const profileTypes: ProfileType[] = ['docs', 'fe', 'be', 'tests']
const sha256Pattern = /^[a-f0-9]{64}$/
const protectedBasenames = new Set([
  '.gitignore',
  'package.json',
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'composer.json',
  'composer.lock',
  'pyproject.toml',
  'poetry.lock',
  'mcp-package.json',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizedRelative(value: string, label: string): string {
  if (
    !value ||
    value.includes('\\') ||
    path.posix.isAbsolute(value) ||
    path.posix.normalize(value) !== value ||
    value === '..' ||
    value.startsWith('../')
  ) {
    throw new Error(`Invalid Platform DNA manifest ${label}: ${value}`)
  }
  return value
}

function isProtectedPath(relative: string): boolean {
  const basename = path.posix.basename(relative)
  return (
    protectedBasenames.has(basename) ||
    /^platform-repos(?:\..+)?\.json$/.test(basename) ||
    /^legacy-repos(?:\..+)?\.json$/.test(basename)
  )
}

function validateManifestFile(targetRel: string, value: unknown): InstallManifestFile {
  const relative = normalizedRelative(targetRel, 'file path')
  if (!relative.startsWith('.cursor/') || isProtectedPath(relative)) {
    throw new Error(`Manifest contains a non-DNA or protected path: ${relative}`)
  }
  if (!isRecord(value)) throw new Error(`Invalid manifest file record: ${relative}`)
  const source = normalizedRelative(String(value.source ?? ''), 'source path')
  if (
    !/^harness\/(?:common|docs|fe|be|tests)\/(?:adapters\/[^/]+\/)?.+/.test(source)
  ) {
    throw new Error(`Manifest contains a non-DNA source: ${source}`)
  }
  const expectedTarget = harnessSourceToTarget(source)
  if (expectedTarget !== relative) {
    throw new Error(`Manifest source/target mismatch: ${source} -> ${relative}`)
  }
  const sha256 = String(value.sha256 ?? '')
  if (!sha256Pattern.test(sha256)) {
    throw new Error(`Invalid manifest sha256 for ${relative}`)
  }
  const state = value.state ?? 'active'
  if (state !== 'active' && state !== 'stale') {
    throw new Error(`Invalid manifest state for ${relative}`)
  }
  return { source, sha256, state }
}

export function validateInstallManifest(value: unknown): InstallManifest {
  if (!isRecord(value)) throw new Error('Invalid Platform DNA install manifest')
  if (value.schemaVersion !== 1) {
    throw new Error('Unsupported Platform DNA install manifest schemaVersion')
  }
  if (value.package !== '@platform/platform-dna' || value.harnessApi !== 1) {
    throw new Error('Incompatible Platform DNA install manifest')
  }
  if (typeof value.packageVersion !== 'string' || !value.packageVersion) {
    throw new Error('Invalid Platform DNA install manifest packageVersion')
  }
  if (!profileTypes.includes(value.type as ProfileType)) {
    throw new Error('Invalid Platform DNA install manifest type')
  }
  if (!isRecord(value.files)) {
    throw new Error('Invalid Platform DNA install manifest files')
  }
  const files: InstallManifest['files'] = {}
  for (const [relative, file] of Object.entries(value.files)) {
    files[relative] = validateManifestFile(relative, file)
  }
  const maps: NonNullable<InstallManifest['maps']> = {}
  if (value.maps !== undefined) {
    if (!isRecord(value.maps)) throw new Error('Invalid Platform DNA install manifest maps')
    for (const [relative, record] of Object.entries(value.maps)) {
      if (
        !['platform-repos.json', 'platform-repos.example.json'].includes(relative) ||
        !isRecord(record) ||
        !sha256Pattern.test(String(record.sha256 ?? ''))
      ) {
        throw new Error(`Invalid Platform DNA managed map record: ${relative}`)
      }
      maps[relative] = { sha256: String(record.sha256) }
    }
  }
  const gitignore = validateManifestGitignore(value)
  const mcp = validateManifestMcp(value.mcp)
  return {
    schemaVersion: 1,
    package: '@platform/platform-dna',
    packageVersion: value.packageVersion,
    type: value.type as ProfileType,
    harnessApi: 1,
    files,
    ...(Object.keys(maps).length ? { maps } : {}),
    ...(gitignore.length ? { gitignore } : {}),
    ...(mcp ? { mcp } : {}),
  }
}

function validCanonicalPattern(pattern: string): boolean {
  return Boolean(pattern) && !/[\r\n]/.test(pattern)
}

function validateManifestGitignore(value: Record<string, unknown>): OwnedGitignoreEntry[] {
  // Back-compat: the boolean form only ever tracked the platform local map.
  // New inits record both local maps as shared via ensureLocalRepoMaps.
  if (value.gitignore === undefined) {
    if (value.gitignoreEntryAdded === true) {
      return [{ pattern: 'platform-repos.local.json', shared: true }]
    }
    if (value.gitignoreEntryAdded !== undefined && typeof value.gitignoreEntryAdded !== 'boolean') {
      throw new Error('Invalid Platform DNA install manifest gitignoreEntryAdded')
    }
    return []
  }
  if (!Array.isArray(value.gitignore)) {
    throw new Error('Invalid Platform DNA install manifest gitignore')
  }
  const seen = new Set<string>()
  const entries: OwnedGitignoreEntry[] = []
  for (const raw of value.gitignore) {
    if (!isRecord(raw) || typeof raw.pattern !== 'string' || !validCanonicalPattern(raw.pattern)) {
      throw new Error('Invalid Platform DNA install manifest gitignore entry')
    }
    if (raw.shared !== undefined && typeof raw.shared !== 'boolean') {
      throw new Error('Invalid Platform DNA install manifest gitignore shared flag')
    }
    if (seen.has(raw.pattern)) continue
    seen.add(raw.pattern)
    entries.push({ pattern: raw.pattern, ...(raw.shared ? { shared: true } : {}) })
  }
  return entries
}

function validateManifestMcp(value: unknown): InstallManifestMcp | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error('Invalid Platform DNA install manifest mcp')
  const file = normalizedRelative(String(value.file ?? ''), 'mcp file')
  if (!file.startsWith('.cursor/') || path.posix.basename(file) !== 'mcp.json') {
    throw new Error(`Invalid Platform DNA managed MCP file: ${file}`)
  }
  if (!isRecord(value.servers)) throw new Error('Invalid Platform DNA install manifest mcp servers')
  const servers: InstallManifestMcp['servers'] = {}
  for (const [name, record] of Object.entries(value.servers)) {
    if (!/^codegraph-[A-Za-z0-9._-]+$/.test(name)) {
      throw new Error(`Invalid Platform DNA managed MCP server name: ${name}`)
    }
    if (!isRecord(record) || !sha256Pattern.test(String(record.sha256 ?? ''))) {
      throw new Error(`Invalid Platform DNA managed MCP server record: ${name}`)
    }
    servers[name] = { sha256: String(record.sha256) }
  }
  return { file, servers }
}

export function readInstallManifest(root: string): InstallManifest | undefined {
  const targetRoot = path.resolve(root)
  const file = targetPath(targetRoot, '.platform-dna/install-manifest.json')
  if (!existsSync(file)) return undefined
  if (lstatSync(file).isSymbolicLink()) {
    throw new Error(`Platform DNA manifest must not be a symlink: ${file}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(
      `Invalid Platform DNA install manifest JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
  return validateInstallManifest(parsed)
}

function targetPath(root: string, relative: string): string {
  const targetRoot = path.resolve(root)
  const target = path.resolve(targetRoot, relative)
  if (target !== targetRoot && !target.startsWith(`${targetRoot}${path.sep}`)) {
    throw new Error(`Platform DNA path escapes project root: ${relative}`)
  }
  let cursor = path.dirname(target)
  while (cursor !== targetRoot) {
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) {
      throw new Error(`Platform DNA path crosses a symlink: ${cursor}`)
    }
    const parent = path.dirname(cursor)
    if (parent === cursor) throw new Error(`Platform DNA path escapes project root: ${relative}`)
    cursor = parent
  }
  return target
}

function fileStatus(root: string, relative: string, file: InstallManifestFile): HarnessFileStatus {
  const target = targetPath(root, relative)
  let status: HarnessFileStatus['status'] = 'missing'
  if (existsSync(target)) {
    status =
      !lstatSync(target).isFile() || hash(readFileSync(target, 'utf8')) !== file.sha256
        ? 'modified'
        : 'unmodified'
  }
  return {
    path: relative,
    ...file,
    status,
    prunable: file.state === 'stale' && status === 'unmodified',
  }
}

export function getHarnessStatus(root: string): HarnessStatus {
  const targetRoot = path.resolve(root)
  const manifest = readInstallManifest(targetRoot)
  if (!manifest) throw new Error(`Platform DNA install manifest not found: ${manifestFile(targetRoot)}`)
  return {
    manifestPath: manifestFile(targetRoot),
    type: manifest.type,
    packageVersion: manifest.packageVersion,
    files: Object.entries(manifest.files)
      .map(([relative, file]) => fileStatus(targetRoot, relative, file))
      .sort((left, right) => left.path.localeCompare(right.path)),
    gitignore: gitignoreStatus(targetRoot, manifest),
    mcp: mcpStatus(targetRoot, manifest),
    localMaps: localMapsStatus(targetRoot),
  }
}

function gitignoreStatus(root: string, manifest: InstallManifest): GitignoreEntryStatus[] {
  const entries = manifest.gitignore ?? []
  if (!entries.length) return []
  const file = path.join(root, '.gitignore')
  const present = new Set<string>()
  if (existsSync(file) && lstatSync(file).isFile()) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim()
      if (trimmed && !trimmed.startsWith('#')) present.add(canonicalGitignorePattern(trimmed))
    }
  }
  return entries.map((entry) => ({
    pattern: entry.pattern,
    shared: Boolean(entry.shared),
    present: present.has(canonicalGitignorePattern(entry.pattern)),
  }))
}

function mcpStatus(root: string, manifest: InstallManifest): McpServerStatus[] {
  if (!manifest.mcp) return []
  const file = targetPath(root, manifest.mcp.file)
  let bag: Record<string, unknown> = {}
  if (existsSync(file) && lstatSync(file).isFile()) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'))
      if (isRecord(parsed) && isRecord(parsed.mcpServers)) {
        bag = parsed.mcpServers as Record<string, unknown>
      }
    } catch {
      bag = {}
    }
  }
  return Object.entries(manifest.mcp.servers).map(([name, record]) => ({
    name,
    status: !(name in bag)
      ? 'missing'
      : mcpEntryHash(bag[name]) === record.sha256
        ? 'unmodified'
        : 'modified',
  }))
}

export function pruneHarness(opts: { root: string; yes?: boolean }): PruneHarnessResult {
  const targetRoot = path.resolve(opts.root)
  const manifest = readInstallManifest(targetRoot)
  if (!manifest) throw new Error(`Platform DNA install manifest not found: ${manifestFile(targetRoot)}`)
  const statuses = Object.entries(manifest.files).map(([relative, file]) =>
    fileStatus(targetRoot, relative, file),
  )
  const prunable = statuses.filter((file) => file.prunable && !isProtectedPath(file.path))
  const result: PruneHarnessResult = {
    dryRun: !opts.yes,
    planned: prunable.map((file) => targetPath(targetRoot, file.path)),
    deleted: [],
    skipped: statuses.filter((file) => file.state === 'stale' && !file.prunable),
  }
  if (!opts.yes) return result

  for (const file of prunable) {
    const target = targetPath(targetRoot, file.path)
    // Recheck immediately before unlinking to avoid deleting a concurrently modified file.
    if (
      existsSync(target) &&
      lstatSync(target).isFile() &&
      hash(readFileSync(target, 'utf8')) === file.sha256
    ) {
      unlinkSync(target)
      delete manifest.files[file.path]
      result.deleted.push(target)
    } else {
      result.skipped.push(fileStatus(targetRoot, file.path, file))
    }
  }
  writeFileSync(
    targetPath(targetRoot, '.platform-dna/install-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )
  return result
}

function mergeGitignore(
  previous: OwnedGitignoreEntry[] | undefined,
  next: OwnedGitignoreEntry[] | undefined,
): OwnedGitignoreEntry[] {
  const byPattern = new Map<string, OwnedGitignoreEntry>()
  for (const entry of [...(previous ?? []), ...(next ?? [])]) {
    const existing = byPattern.get(entry.pattern)
    byPattern.set(entry.pattern, {
      pattern: entry.pattern,
      ...(entry.shared || existing?.shared ? { shared: true } : {}),
    })
  }
  return [...byPattern.values()]
}

function mergeManifestMcp(
  previous: InstallManifestMcp | undefined,
  next: InstallManifestMcp | undefined,
): InstallManifestMcp | undefined {
  if (!previous && !next) return undefined
  const file = next?.file ?? previous!.file
  const servers = { ...(previous?.servers ?? {}) }
  for (const [name, record] of Object.entries(next?.servers ?? {})) {
    servers[name] = record
  }
  if (!Object.keys(servers).length) return undefined
  return { file, servers }
}

export function installHarness(opts: {
  root: string
  type: ProfileType
  adapter?: string
  force?: boolean
  seededMaps?: SeededProjectMap[]
  gitignoreEntries?: OwnedGitignoreEntry[]
  mcp?: InstallManifestMcp
}): { written: string[]; unchanged: string[]; conflicts: string[] } {
  const targetRoot = path.resolve(opts.root)
  const previous = readInstallManifest(targetRoot)
  const roots: Array<{ dir: string; skipNames?: Set<string> }> = [
    { dir: path.join(packageRoot(), 'harness', 'common') },
    // Skip adapters/ so lane walk does not copy overlay trees into .cursor/adapters/
    { dir: path.join(packageRoot(), 'harness', opts.type), skipNames: new Set(['adapters']) },
  ]
  if (opts.adapter) {
    const overlay = path.join(
      packageRoot(),
      'harness',
      opts.type,
      'adapters',
      opts.adapter,
    )
    if (existsSync(overlay)) roots.push({ dir: overlay })
  }
  const result = {
    written: [] as string[],
    unchanged: [] as string[],
    conflicts: [] as string[],
  }
  const files: InstallManifest['files'] = Object.fromEntries(
    Object.entries(previous?.files ?? {}).map(([relative, file]) => [
      relative,
      { ...file, state: 'stale' as const },
    ]),
  )

  for (const sourceRoot of roots) {
    for (const source of walk(sourceRoot.dir, { skipNames: sourceRoot.skipNames })) {
      const sourceRel = path.relative(packageRoot(), source).split(path.sep).join('/')
      const targetRel = harnessSourceToTarget(sourceRel)
      const target = targetPath(targetRoot, targetRel)
      const content = readFileSync(source, 'utf8')
      files[targetRel] = {
        source: sourceRel,
        sha256: hash(content),
        state: 'active',
      }
      if (existsSync(target)) {
        if (!lstatSync(target).isFile()) {
          result.conflicts.push(target)
          continue
        }
        const current = readFileSync(target, 'utf8')
        if (current === content) {
          result.unchanged.push(target)
          continue
        }
        const safe = previous?.files[targetRel]?.sha256 === hash(current)
        // Thin Bundlekit/Processkit copies of /configure-repo-maps yield to DNA SSOT.
        const replaceThin =
          targetRel === CONFIGURE_REPO_MAPS_REL && isVendorThinConfigureRepoMaps(current)
        if (!opts.force && !safe && !replaceThin) {
          result.conflicts.push(target)
          continue
        }
      }
      mkdirSync(path.dirname(target), { recursive: true })
      writeFileSync(target, content)
      result.written.push(target)
    }
  }

  const manifest: InstallManifest = {
    schemaVersion: 1,
    package: '@platform/platform-dna',
    packageVersion: packageVersion(),
    type: opts.type,
    harnessApi: 1,
    files,
    maps: opts.seededMaps
      ? Object.fromEntries(
          opts.seededMaps
            .filter((map) => map.created || previous?.maps?.[map.path])
            .map((map) => [map.path, { sha256: map.sha256 }]),
        )
      : previous?.maps,
  }
  const gitignore = mergeGitignore(previous?.gitignore, opts.gitignoreEntries)
  if (gitignore.length) manifest.gitignore = gitignore
  const mcp = mergeManifestMcp(previous?.mcp, opts.mcp)
  if (mcp) manifest.mcp = mcp
  const installManifest = targetPath(targetRoot, '.platform-dna/install-manifest.json')
  mkdirSync(path.dirname(installManifest), { recursive: true })
  writeFileSync(installManifest, `${JSON.stringify(manifest, null, 2)}\n`)
  recordInstall(targetRoot)
  return result
}

/**
 * Update only the managed gitignore/MCP metadata on an existing install (used by
 * the idempotent `codegraph:wire` command without re-walking the harness tree).
 */
export function recordManagedExtras(
  root: string,
  opts: { gitignore?: OwnedGitignoreEntry[]; mcp?: InstallManifestMcp },
): InstallManifest {
  const targetRoot = path.resolve(root)
  const manifest = readInstallManifest(targetRoot)
  if (!manifest) {
    throw new Error(`Platform DNA install manifest not found: ${manifestFile(targetRoot)}`)
  }
  const gitignore = mergeGitignore(manifest.gitignore, opts.gitignore)
  if (gitignore.length) manifest.gitignore = gitignore
  const mcp = mergeManifestMcp(manifest.mcp, opts.mcp)
  if (mcp) manifest.mcp = mcp
  writeFileSync(
    targetPath(targetRoot, '.platform-dna/install-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )
  return manifest
}

/**
 * Remove only assets proven to be Platform-DNA-owned by the validated manifest.
 * Member-modified files and maps that predated manifest ownership are preserved.
 */
export function uninstallHarness(opts: {
  root: string
  yes?: boolean
}): UninstallHarnessResult {
  const targetRoot = path.resolve(opts.root)
  const manifest = readInstallManifest(targetRoot)
  const dryRun = !opts.yes
  const result: UninstallHarnessResult = {
    dryRun,
    wouldDelete: [],
    deleted: [],
    preservedModified: [],
    missing: [],
    manifestRemoved: false,
  }
  if (!manifest) return result

  const owned = [
    ...Object.entries(manifest.files).map(([relative, file]) => [
      relative,
      file.sha256,
    ] as const),
    ...Object.entries(manifest.maps ?? {}).map(([relative, file]) => [
      relative,
      file.sha256,
    ] as const),
  ]
  for (const [relative, expectedHash] of owned) {
    const target = targetPath(targetRoot, relative)
    if (!existsSync(target)) {
      result.missing.push(target)
      continue
    }
    if (
      !lstatSync(target).isFile() ||
      hash(readFileSync(target, 'utf8')) !== expectedHash
    ) {
      result.preservedModified.push(target)
      continue
    }
    if (dryRun) result.wouldDelete.push(target)
    else {
      unlinkSync(target)
      result.deleted.push(target)
    }
  }

  // Remove only exclusively-owned ignore entries; shared entries (for example
  // `.cursor/mcp.json`) may still be relied on by another toolkit, so keep them.
  const exclusiveIgnore = (manifest.gitignore ?? [])
    .filter((entry) => !entry.shared)
    .map((entry) => entry.pattern)
  if (exclusiveIgnore.length) {
    if (dryRun) {
      const file = path.join(targetRoot, '.gitignore')
      const present =
        existsSync(file) && lstatSync(file).isFile()
          ? new Set(
              readFileSync(file, 'utf8')
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter((line) => line && !line.startsWith('#'))
                .map(canonicalGitignorePattern),
            )
          : new Set<string>()
      for (const pattern of exclusiveIgnore) {
        if (present.has(canonicalGitignorePattern(pattern))) {
          result.wouldDelete.push(`${file} entry: ${pattern}`)
        }
      }
    } else {
      const removed = removeGitignoreEntries(targetRoot, exclusiveIgnore)
      for (const pattern of removed.removed) {
        result.deleted.push(`${removed.file} entry: ${pattern}`)
      }
    }
  }

  if (manifest.mcp) {
    const file = targetPath(targetRoot, manifest.mcp.file)
    const expected = Object.fromEntries(
      Object.entries(manifest.mcp.servers).map(([name, record]) => [name, record.sha256]),
    )
    const mcpResult = removeMcpServers(file, expected, { dryRun })
    for (const name of mcpResult.removed) {
      ;(dryRun ? result.wouldDelete : result.deleted).push(`${file} server: ${name}`)
    }
    for (const name of mcpResult.preservedModified) {
      result.preservedModified.push(`${file} server: ${name}`)
    }
  }

  const installManifest = targetPath(targetRoot, '.platform-dna/install-manifest.json')
  if (dryRun) {
    result.wouldDelete.push(installManifest)
    return result
  }
  if (existsSync(installManifest)) {
    unlinkSync(installManifest)
    result.manifestRemoved = true
  }
  forgetInstall(targetRoot)
  try {
    rmdirSync(path.dirname(installManifest))
  } catch {
    // Preserve non-empty local Platform DNA config.
  }
  return result
}
