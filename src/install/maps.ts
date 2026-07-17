import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ProfileType } from '../config/project-root.js'

const PLATFORM_SCHEMA =
  'https://github.com/raintr91/platform-dna/blob/main/templates/schemas/platform-repos.schema.json'
const LEGACY_SCHEMA =
  'https://github.com/raintr91/platform-dna/blob/main/templates/schemas/legacy-repos.schema.json'
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

export function seedProjectMaps(opts: {
  root: string
  type: ProfileType
  repoName?: string
  repoUrl?: string
}): { written: string[]; unchanged: string[] } {
  const root = path.resolve(opts.root)
  const repoName = opts.repoName ?? path.basename(root)
  const platformFile = path.join(root, 'platform-repos.json')
  const exampleFile = path.join(root, 'platform-repos.example.json')
  assertPortableMap(platformFile)
  assertPortableMap(exampleFile)

  const data: any = existsSync(platformFile)
    ? parse(platformFile)
    : {
        $schema: PLATFORM_SCHEMA,
        defaultGroup: opts.type,
        harness: { profiles: {} },
        groups: {},
        projects: {},
      }
  data.$schema ??= PLATFORM_SCHEMA
  data.defaultGroup ??= opts.type
  data.harness ??= {}
  data.harness.profiles ??= {}
  data.harness.profiles[opts.type] ??= {
    groups: [opts.type],
    skills: opts.type === 'docs' ? ['platform-ai'] : [],
  }
  data.groups ??= {}
  data.groups[opts.type] ??= {
    description: `${opts.type.toUpperCase()} current repository`,
    primary: repoName,
    projects: [repoName],
  }
  data.projects ??= {}
  const current = Object.entries(data.projects).find(
    ([, project]: [string, any]) => project?.root === '.',
  )
  if (current && current[0] !== repoName) {
    throw new Error(
      `platform-repos.json already maps root "." as ${current[0]}; use that repository name`,
    )
  }
  data.projects[repoName] ??= {
    root: '.',
    role: opts.type,
    repo: repoName,
    ...(opts.repoUrl ? { url: opts.repoUrl } : {}),
    write: true,
  }

  const written: string[] = []
  const unchanged: string[] = []
  ;(writeIfChanged(platformFile, data) ? written : unchanged).push(platformFile)
  ;(writeIfChanged(exampleFile, data) ? written : unchanged).push(exampleFile)

  if (opts.type === 'docs') {
    for (const name of ['legacy-repos.json', 'legacy-repos.example.json']) {
      const file = path.join(root, name)
      assertPortableMap(file)
      const value = existsSync(file) ? parse(file) : { $schema: LEGACY_SCHEMA, projects: {} }
      ;(writeIfChanged(file, value) ? written : unchanged).push(file)
    }
  }

  const gitignore = path.join(root, '.gitignore')
  const existing = existsSync(gitignore) ? readFileSync(gitignore, 'utf8') : ''
  const additions = ['platform-repos.local.json', 'legacy-repos.local.json'].filter(
    (line) => !existing.split(/\r?\n/).includes(line),
  )
  if (additions.length) {
    const prefix = existing && !existing.endsWith('\n') ? '\n' : ''
    writeFileSync(gitignore, `${existing}${prefix}${additions.join('\n')}\n`)
    written.push(gitignore)
  } else {
    unchanged.push(gitignore)
  }
  return { written, unchanged }
}
