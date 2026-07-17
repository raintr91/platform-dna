import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import {
  packageRoot,
  packageVersion,
  type ProfileType,
} from '../config/project-root.js'

interface InstallManifest {
  schemaVersion: 1
  package: '@platform/platform-dna'
  packageVersion: string
  type: ProfileType
  harnessApi: 1
  files: Record<string, { source: string; sha256: string }>
}

function hash(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function walk(root: string): string[] {
  if (!existsSync(root)) return []
  return readdirSync(root).flatMap((name) => {
    const file = path.join(root, name)
    return statSync(file).isDirectory() ? walk(file) : [file]
  })
}

function manifestFile(root: string): string {
  return path.join(root, '.platform-dna', 'install-manifest.json')
}

export function installHarness(opts: {
  root: string
  type: ProfileType
  force?: boolean
}): { written: string[]; unchanged: string[]; conflicts: string[] } {
  const targetRoot = path.resolve(opts.root)
  const previous: InstallManifest | undefined = existsSync(manifestFile(targetRoot))
    ? (JSON.parse(readFileSync(manifestFile(targetRoot), 'utf8')) as InstallManifest)
    : undefined
  const roots = [
    path.join(packageRoot(), 'harness', 'common'),
    path.join(packageRoot(), 'harness', opts.type),
  ]
  const result = {
    written: [] as string[],
    unchanged: [] as string[],
    conflicts: [] as string[],
  }
  const files: InstallManifest['files'] = {}

  for (const sourceRoot of roots) {
    for (const source of walk(sourceRoot)) {
      const rel = path.relative(sourceRoot, source)
      const targetRel = path.join('.cursor', rel).split(path.sep).join('/')
      const target = path.join(targetRoot, targetRel)
      const content = readFileSync(source, 'utf8')
      files[targetRel] = {
        source: path.relative(packageRoot(), source).split(path.sep).join('/'),
        sha256: hash(content),
      }
      if (existsSync(target)) {
        const current = readFileSync(target, 'utf8')
        if (current === content) {
          result.unchanged.push(target)
          continue
        }
        const safe = previous?.files[targetRel]?.sha256 === hash(current)
        if (!opts.force && !safe) {
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
  }
  mkdirSync(path.dirname(manifestFile(targetRoot)), { recursive: true })
  writeFileSync(manifestFile(targetRoot), `${JSON.stringify(manifest, null, 2)}\n`)
  return result
}
