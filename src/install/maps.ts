import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ProfileType } from '../config/project-root.js'
import { ensureGitignoreEntries, type OwnedGitignoreEntry } from './gitignore.js'
import {
  ensureLocalRepoMaps,
  type EnsureLocalRepoMapsResult,
} from './local-maps.js'

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
  /** Machine-local map ensure (both `.local.json`); shared ignore ownership. */
  localMaps: EnsureLocalRepoMapsResult
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
  // Preserve sibling catalog entries when the map already exists; only upsert
  // the current-repo (root ".") entry and its group primary.
  if (!platformExisted) {
    data.groups = {
      [opts.type]: {
        description: `${opts.type.toUpperCase()} current repository`,
        primary: repoName,
        projects: [repoName],
      },
    }
    data.projects = {}
  } else {
    data.groups = data.groups && typeof data.groups === 'object' ? data.groups : {}
    data.projects = data.projects && typeof data.projects === 'object' ? data.projects : {}
    const group = (data.groups[opts.type] ??= {
      description: `${opts.type.toUpperCase()} current repository`,
      primary: repoName,
      projects: [] as string[],
    })
    group.primary = repoName
    const projects = Array.isArray(group.projects) ? group.projects : []
    if (!projects.includes(repoName)) projects.push(repoName)
    group.projects = projects
  }
  data.projects[repoName] = {
    root: '.',
    role: opts.type,
    repo: repoName,
    ...(opts.repoUrl
      ? { url: opts.repoUrl }
      : typeof currentProject?.url === 'string'
        ? { url: currentProject.url }
        : {}),
    write: typeof currentProject?.write === 'boolean' ? currentProject.write : true,
  }

  const written: string[] = []
  const unchanged: string[] = []
  ;(writeIfChanged(platformFile, data) ? written : unchanged).push(platformFile)
  ;(writeIfChanged(exampleFile, data) ? written : unchanged).push(exampleFile)

  // Machine-local maps: create-if-missing only (never seed portable legacy-repos*).
  const localMaps = ensureLocalRepoMaps(root)
  for (const file of localMaps.created) written.push(path.join(root, file))
  for (const file of localMaps.skipped) unchanged.push(path.join(root, file))

  const additionalIgnores = [
    '.platform-dna',
    'platform-repos.json',
    'platform-repos.example.json',
    'legacy-repos.json',
    'legacy-repos.example.json'
  ]
  const extraGitignore = ensureGitignoreEntries(root, additionalIgnores)

  const gitignoreEntries: OwnedGitignoreEntry[] = [
    ...localMaps.gitignoreEntries,
    ...additionalIgnores.map((pattern) => ({ pattern, shared: true }))
  ]

  const hasGitignoreAdded = localMaps.gitignoreAdded.length > 0 || extraGitignore.added.length > 0
  if (hasGitignoreAdded) written.push(path.join(root, '.gitignore'))
  else unchanged.push(path.join(root, '.gitignore'))

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
    localMaps,
    gitignoreAdded: hasGitignoreAdded,
    gitignoreEntries,
  }
}
