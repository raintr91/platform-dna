import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ProfileType } from '../config/project-root.js'
import { ensureGitignoreEntries, type OwnedGitignoreEntry } from './gitignore.js'

const PLATFORM_SCHEMA =
  'https://github.com/raintr91/platform-dna/blob/main/templates/schemas/platform-repos.schema.json'
const NON_PORTABLE = /(?:^|["'\s])(?:\.\.\/|~\/|\/home\/|[A-Za-z]:[\\/]|\\\\)/

function parse(file: string): any {
  return JSON.parse(readFileSync(file, 'utf8'))
}

export function assertPortableMap(file: string): void {
  if (!existsSync(file)) return
  const body = readFileSync(file, 'utf8')
  if (NON_PORTABLE.test(body)) {
    throw new Error(
      `${file} contains a machine/sibling path; move checkout roots to an ignored *.local.json`,
    )
  }
  JSON.parse(body)
}

function writeIfChanged(file: string, data: unknown): boolean {
  const body = `${JSON.stringify(data, null, 2)}\n`
  if (existsSync(file) && readFileSync(file, 'utf8') === body) return false
  writeFileSync(file, body)
  return true
}

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

export interface SeededProjectMap {
  path: 'platform-repos.json' | 'platform-repos.example.json'
  sha256: string
  created: boolean
}

export function seedProjectMaps(opts: {
  root: string
  type: ProfileType
  repoName?: string
  repoUrl?: string
}): {
  written: string[]
  unchanged: string[]
  maps: SeededProjectMap[]
  gitignoreAdded: boolean
  gitignoreEntries: OwnedGitignoreEntry[]
} {
  const root = path.resolve(opts.root)
  const repoName = opts.repoName ?? path.basename(root)
  const platformFile = path.join(root, 'platform-repos.json')
  const exampleFile = path.join(root, 'platform-repos.example.json')
  const platformExisted = existsSync(platformFile)
  const exampleExisted = existsSync(exampleFile)
  assertPortableMap(platformFile)
  assertPortableMap(exampleFile)

  const data: any = existsSync(platformFile)
    ? parse(platformFile)
    : {
        $schema: PLATFORM_SCHEMA,
        defaultGroup: opts.type,
        groups: {},
        projects: {},
      }
  data.$schema = PLATFORM_SCHEMA
  data.defaultGroup = opts.type
  // Project maps describe repositories only. Installed toolkit assets belong in
  // each toolkit's install manifest, never in this map.
  delete data.harness
  const current = Object.entries(data.projects ?? {}).find(
    ([, project]: [string, any]) => project?.root === '.',
  )
  if (current && current[0] !== repoName) {
    throw new Error(
      `platform-repos.json already maps root "." as ${current[0]}; use that repository name`,
    )
  }
  const currentProject = current?.[1] as Record<string, unknown> | undefined
  data.groups = {
    [opts.type]: {
      description: `${opts.type.toUpperCase()} current repository`,
      primary: repoName,
      projects: [repoName],
    },
  }
  data.projects = {
    [repoName]: {
      root: '.',
      role: opts.type,
      repo: repoName,
      ...(opts.repoUrl
        ? { url: opts.repoUrl }
        : typeof currentProject?.url === 'string'
          ? { url: currentProject.url }
          : {}),
      write: typeof currentProject?.write === 'boolean' ? currentProject.write : true,
    },
  }

  const written: string[] = []
  const unchanged: string[] = []
  ;(writeIfChanged(platformFile, data) ? written : unchanged).push(platformFile)
  ;(writeIfChanged(exampleFile, data) ? written : unchanged).push(exampleFile)

  // The machine-local map is the only ignore entry Platform DNA exclusively
  // owns from seeding; it must never be committed (holds member checkout roots).
  const gitignoreResult = ensureGitignoreEntries(root, ['platform-repos.local.json'])
  ;(gitignoreResult.changed ? written : unchanged).push(gitignoreResult.file)
  // Only claim ownership of entries this run actually added, so deinit never
  // strips a line the member wrote themselves.
  const gitignoreEntries: OwnedGitignoreEntry[] = gitignoreResult.added.map((pattern) => ({
    pattern,
    shared: false,
  }))

  return {
    written,
    unchanged,
    maps: [
      {
        path: 'platform-repos.json',
        sha256: sha256(platformFile),
        created: !platformExisted,
      },
      {
        path: 'platform-repos.example.json',
        sha256: sha256(exampleFile),
        created: !exampleExisted,
      },
    ],
    gitignoreAdded: gitignoreResult.changed,
    gitignoreEntries,
  }
}
