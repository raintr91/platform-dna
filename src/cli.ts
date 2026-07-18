import path from 'node:path'
import {
  packageRoot,
  packageVersion,
  resolveProjectRoot,
  resolveType,
} from './config/project-root.js'
import { loadProfiles } from './profile/manifest.js'
import { validateTarget } from './profile/detect.js'
import {
  getHarnessStatus,
  installHarness,
  pruneHarness,
} from './install/harness.js'
import { assertPortableMap, seedProjectMaps } from './install/maps.js'
import {
  installProfilePackages,
  resolvePackageSet,
} from './install/packages.js'

function arg(name: string): string | undefined {
  const equal = process.argv.find((value) => value.startsWith(`${name}=`))
  if (equal) return equal.slice(name.length + 1)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function has(name: string): boolean {
  return process.argv.includes(name)
}

function list(name: string): string[] {
  return (arg(name) ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

function packageRoots(): Record<string, string> {
  const result: Record<string, string> = {}
  for (let index = 0; index < process.argv.length; index += 1) {
    const current = process.argv[index]
    const value = current.startsWith('--package-root=')
      ? current.slice('--package-root='.length)
      : current === '--package-root'
        ? process.argv[index + 1]
        : undefined
    if (!value) continue
    const split = value.indexOf('=')
    if (split <= 0) throw new Error('--package-root must be packageId=/absolute/path')
    result[value.slice(0, split)] = path.resolve(value.slice(split + 1))
  }
  return result
}

function usage(): never {
  console.log(`platform-dna ${packageVersion()}

  init --type=docs|fe|be|tests [--adapter=…] [--with=artifactgraph]
       [--project-root <path>] [--docs-root <path>]
       [--repo-name <id>] [--repo-url <url>]
       [--package-root packageId=/path] [--no-install] [--force] [--dry-run] [--yes]
  validate --type=… [--adapter=…] [--project-root <path>]
  status [--project-root <path>]
  prune [--project-root <path>] [--yes] [--dry-run]
  profile --type=…
  version

Platform DNA installs only into docs/code hubs (docs · fe · be · tests).
Never init into MCP tooling repos (hubdocs, bundlekit, …).
Specialist skills/tools remain owned by their package.
`)
  process.exit(1)
}

async function main(): Promise<void> {
  const command = process.argv[2]
  if (!command || command === 'help' || command === '--help') usage()
  if (command === 'version' || command === '--version') {
    console.log(`platform-dna ${packageVersion()}`)
    console.log(`packageRoot ${packageRoot()}`)
    return
  }

  const root = resolveProjectRoot(arg('--project-root'))
  if (command === 'status') {
    console.log(JSON.stringify(getHarnessStatus(root), null, 2))
    return
  }
  if (command === 'prune') {
    const result = pruneHarness({
      root,
      yes: has('--yes') && !has('--dry-run'),
    })
    console.log(JSON.stringify(result, null, 2))
    if (result.dryRun) console.log('platform-dna prune: dry-run (pass --yes to delete)')
    return
  }

  const manifest = loadProfiles()
  const type = resolveType(arg('--type'))
  const profile = manifest.profiles[type]
  const adapter = arg('--adapter')
  const docsRoot = arg('--docs-root')

  if (command === 'profile') {
    console.log(JSON.stringify({ type, ...profile }, null, 2))
    return
  }

  validateTarget({
    root,
    type,
    profile,
    adapter,
    force: has('--force'),
  })
  assertPortableMap(path.join(root, 'platform-repos.json'))
  assertPortableMap(path.join(root, 'platform-repos.example.json'))

  if (command === 'validate') {
    console.log(`platform-dna validate: OK (${type}, ${root})`)
    return
  }
  if (command !== 'init') usage()

  const packageIds = resolvePackageSet({
    manifest,
    type,
    adapter,
    withOptional: list('--with'),
  })
  if (has('--dry-run')) {
    const plan = installProfilePackages({
      manifest,
      type,
      packageIds,
      projectRoot: root,
      adapter,
      docsRoot,
      force: has('--force'),
      dryRun: true,
    })
    console.log(
      JSON.stringify({ type, root, adapter, docsRoot, packageIds, invocations: plan }, null, 2),
    )
    return
  }

  const maps = seedProjectMaps({
    root,
    type,
    repoName: arg('--repo-name'),
    repoUrl: arg('--repo-url'),
  })
  for (const file of maps.written) console.log(`  wrote: ${file}`)
  const harness = installHarness({
    root,
    type,
    adapter,
    force: has('--force'),
  })
  for (const file of harness.written) console.log(`  wrote: ${file}`)
  for (const file of harness.unchanged) console.log(`  unchanged: ${file}`)
  for (const file of harness.conflicts) console.log(`  conflict: ${file}`)
  if (harness.conflicts.length) {
    throw new Error('Platform DNA harness conflicts; review files or rerun with explicit --force')
  }

  const plan = installProfilePackages({
    manifest,
    type,
    packageIds,
    projectRoot: root,
    adapter,
    docsRoot,
    force: has('--force'),
    installMissing: !has('--no-install'),
    packageRoots: packageRoots(),
  })
  for (const step of plan) {
    console.log(`  ${step.packageId}: ${step.argv.join(' ')}`)
  }
  console.log(`platform-dna init complete: ${type} (${packageIds.join(', ') || 'meta only'})`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
