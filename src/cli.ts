import { lstatSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  packageRoot,
  packageVersion,
  resolveProjectRoot,
  resolveType,
  type ProfileType,
} from './config/project-root.js'
import { loadProfiles } from './profile/manifest.js'
import { validateTarget } from './profile/detect.js'
import {
  getHarnessStatus,
  installHarness,
  pruneHarness,
  uninstallHarness,
} from './install/harness.js'
import { assertPortableMap, seedProjectMaps } from './install/maps.js'
import {
  installProfilePackages,
  resolvePackageSet,
} from './install/packages.js'
import { selectPrompt } from './install/prompt.js'
import {
  discoverInstalls,
  ledgerPath,
  readLedger,
  removeLedger,
} from './install/ledger.js'

const laneChoices: Array<{ value: ProfileType; name: string }> = [
  { value: 'docs', name: 'Docs' },
  { value: 'fe', name: 'Frontend (FE)' },
  { value: 'be', name: 'Backend (BE)' },
  { value: 'tests', name: 'Tests' },
]

const adapterNames: Record<string, string> = {
  nuxt4: 'Nuxt 4',
  nextjs: 'Next.js',
  'dotnet-line': '.NET Line',
  fastapi: 'FastAPI',
  laravel: 'Laravel',
  'dotnet-integration': '.NET Integration',
}

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

  init [--type=docs|fe|be|tests] [--adapter=…] [--with=artifactgraph]
       [--project-root <path>] [--docs-root <path>]
       [--repo-name <id>] [--repo-url <url>]
       [--package-root packageId=/path] [--no-install] [--force] [--dry-run] [--yes]
  validate --type=… [--adapter=…] [--project-root <path>]
  status [--project-root <path>]
  prune [--project-root <path>] [--yes] [--dry-run]
  deinit [--project-root <path>] [--yes]
  uninstall [--discover <dir>] [--yes]
  profile --type=…
  version

Platform DNA installs only into docs/code hubs (docs · fe · be · tests).
Run "platform-dna init" in a terminal to select a lane and adapter.
Never init into MCP tooling repos (hubdocs, bundlekit, …).
Specialist skills/tools remain owned by their package.
`)
  process.exit(1)
}

function lexists(file: string): boolean {
  try {
    lstatSync(file)
    return true
  } catch {
    return false
  }
}

function cliTargets(): string[] {
  const installDir = path.resolve(
    process.env.PLATFORM_DNA_INSTALL_DIR ??
      path.join(os.homedir(), '.platform-dna', 'bootstrap'),
  )
  const binDir = path.resolve(
    process.env.PLATFORM_DNA_BIN_DIR ?? path.join(os.homedir(), '.local', 'bin'),
  )
  return [
    path.join(binDir, process.platform === 'win32' ? 'platform-dna.cmd' : 'platform-dna'),
    installDir,
  ]
}

function printRepoUninstall(root: string, yes: boolean): void {
  console.log(`repo: ${root}`)
  const result = uninstallHarness({ root, yes })
  for (const file of result.wouldDelete) console.log(`  would delete: ${file}`)
  for (const file of result.deleted) console.log(`  deleted: ${file}`)
  for (const file of result.preservedModified) console.log(`  preserve modified: ${file}`)
  for (const file of result.missing) console.log(`  already missing: ${file}`)
  if (result.manifestRemoved) {
    console.log(`  manifest removed: ${path.join(root, '.platform-dna/install-manifest.json')}`)
  }
}

function runLifecycle(scope: 'repo' | 'all', yes: boolean): void {
  if (scope === 'repo') {
    printRepoUninstall(resolveProjectRoot(arg('--project-root')), yes)
    return
  }

  const repos = new Set(readLedger())
  const discover = arg('--discover')
  if (discover) {
    for (const root of discoverInstalls(discover)) repos.add(root)
  }
  if (!repos.size) console.log('  (no registered repos — try --discover <dir>)')
  for (const root of repos) printRepoUninstall(root, yes)

  for (const target of cliTargets()) {
    if (!lexists(target)) continue
    if (yes) {
      try {
        rmSync(target, { recursive: true, force: true })
        console.log(`  removed: ${target}`)
      } catch (error) {
        console.log(`  preserve: ${target} (${error instanceof Error ? error.message : error})`)
      }
    } else {
      console.log(`  would remove: ${target}`)
    }
  }
  if (yes) {
    if (removeLedger()) console.log(`  ledger removed: ${ledgerPath()}`)
  } else {
    console.log(`  would remove ledger: ${ledgerPath()}`)
  }
}

async function runUninstall(scope: 'repo' | 'all'): Promise<void> {
  const yes = has('--yes') && !has('--dry-run')
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY && !yes)
  if (interactive) {
    console.log(`\nPreview (${scope}):`)
    runLifecycle(scope, false)
    const confirmation = await selectPrompt<'yes' | 'no'>({
      message:
        scope === 'repo'
          ? 'Apply platform-dna deinit for this repo?'
          : 'Apply global platform-dna uninstall (all repos + CLI)?',
      defaultIndex: 0,
      choices: [
        { value: 'no', name: 'No — cancel' },
        { value: 'yes', name: 'Yes — remove now' },
      ],
    })
    if (confirmation !== 'yes') {
      console.log('Cancelled.')
      return
    }
    console.log(`\nApplying (${scope}):`)
    runLifecycle(scope, true)
    console.log(`\nUninstalled (${scope}).`)
    return
  }
  runLifecycle(scope, yes)
  console.log(yes ? `\nUninstalled (${scope}).` : `\nDry-run (${scope}) — pass --yes to apply.`)
}

async function main(): Promise<void> {
  const command = process.argv[2]
  if (!command || command === 'help' || command === '--help') usage()
  if (command === 'version' || command === '--version') {
    console.log(`platform-dna ${packageVersion()}`)
    console.log(`packageRoot ${packageRoot()}`)
    return
  }

  if (command === 'deinit') {
    await runUninstall('repo')
    return
  }
  if (command === 'uninstall') {
    await runUninstall('all')
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
  const requestedType = arg('--type')
  const interactiveInit =
    command === 'init' &&
    !has('--yes') &&
    Boolean(process.stdin.isTTY && process.stdout.isTTY)
  const type =
    interactiveInit && !requestedType
      ? await selectPrompt({
          message: 'Select the destination lane:',
          choices: laneChoices,
        })
      : resolveType(requestedType)
  const profile = manifest.profiles[type]
  let adapter = arg('--adapter')
  if (interactiveInit && profile.requiresAdapter && !adapter) {
    adapter = await selectPrompt({
      message: `Select the ${type.toUpperCase()} adapter:`,
      choices: (profile.adapters ?? []).map((value) => ({
        value,
        name: adapterNames[value] ?? value,
      })),
    })
  }
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
    seededMaps: maps.maps,
    gitignoreAdded: maps.gitignoreAdded,
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
