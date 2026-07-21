import { lstatSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  packageRoot,
  packageVersion,
  resolveProjectRoot,
} from './config/project-root.js'
import { loadProfiles } from './profile/manifest.js'
import { validateTarget } from './profile/detect.js'
import {
  getHarnessStatus,
  installHarness,
  pruneHarness,
  readInstallManifest,
  recordManagedExtras,
  uninstallHarness,
} from './install/harness.js'
import { assertPortableMap, seedProjectMaps } from './install/maps.js'

import { selectPrompt } from './install/prompt.js'
import { resolveInitWizard } from './install/init-wizard.js'
import {
  discoverInstalls,
  ledgerPath,
  readLedger,
  removeLedger,
} from './install/ledger.js'
import { ensureGitignoreEntries, type OwnedGitignoreEntry } from './install/gitignore.js'
import { CODEGRAPH_MCP_FILE, wireCodegraph, type WireCodegraphResult } from './install/codegraph.js'
import type { InstallManifestMcp } from './install/harness.js'

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



function usage(): never {
  console.log(`platform-dna ${packageVersion()}

  init [--target=agent,…|auto|all|none] [--type=docs|fe|be|tests] [--adapter=…]
       [--codegraph | --no-codegraph] [--codegraph-repos=key,…]
       [--project-root <path>] [--docs-root <path>]
       [--repo-name <id>] [--repo-url <url>]
       [--force] [--dry-run] [--yes]
  validate --type=… [--adapter=…] [--project-root <path>]
  status [--project-root <path>]
  prune [--project-root <path>] [--yes] [--dry-run]
  codegraph:wire [--project-root <path>] [--codegraph-repos=key,…]
       [--include-self] [--dry-run] [--yes]
  deinit [--project-root <path>] [--yes]
  uninstall [--discover <dir>] [--yes]
  profile --type=…
  version

Platform DNA installs only into docs/code hubs (docs · fe · be · tests).
Run "platform-dna init" in a terminal to select agents, a lane, and an adapter.
Never init into MCP tooling repos (docskit, processkit, …).
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

function reportCodegraphPlan(wire: WireCodegraphResult): void {
  for (const server of wire.plan.wire) {
    const merged =
      wire.merge?.added.includes(server.name)
        ? 'wired'
        : wire.merge?.updated.includes(server.name)
          ? 'updated'
          : wire.merge
            ? 'unchanged'
            : 'planned'
    console.log(`  codegraph: ${merged} ${server.name} → ${server.root}`)
  }
  for (const item of wire.plan.needsIndex) {
    console.log(`  codegraph: ${item.key} has no index yet — run: ${item.hint}`)
  }
  for (const server of wire.plan.skipped) {
    console.log(`  codegraph: skip ${server.name} (${server.skipped})`)
  }
}

function runCodegraphWire(): void {
  const root = resolveProjectRoot(arg('--project-root'))
  const dryRun = has('--dry-run') && !has('--yes')
  const wire = wireCodegraph({
    root,
    filterKeys: list('--codegraph-repos'),
    includeSelf: has('--include-self'),
    dryRun,
  })
  reportCodegraphPlan(wire)
  if (wire.manifestMcp) {
    const mcpIgnore = ensureGitignoreEntries(root, [CODEGRAPH_MCP_FILE])
    if (mcpIgnore.changed) console.log(`  wrote: ${mcpIgnore.file} (${CODEGRAPH_MCP_FILE})`)
    if (readInstallManifest(root)) {
      recordManagedExtras(root, {
        gitignore: [{ pattern: CODEGRAPH_MCP_FILE, shared: true }],
        mcp: wire.manifestMcp,
      })
    }
  }
  console.log(
    dryRun
      ? `codegraph:wire dry-run (${root}) — pass --yes to apply.`
      : `codegraph:wire complete (${root}).`,
  )
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
  if (command === 'codegraph:wire') {
    runCodegraphWire()
    return
  }

  const manifest = loadProfiles()
  const interactiveInit =
    command === 'init' &&
    !has('--yes') &&
    Boolean(process.stdin.isTTY && process.stdout.isTTY)
  const codegraphFilter = list('--codegraph-repos')
  const codegraphCandidateKeys =
    command === 'init'
      ? wireCodegraph({ root, filterKeys: codegraphFilter, dryRun: true }).plan.wire.map(
        (server) => server.key,
      )
      : []
  const selection = await resolveInitWizard({
    root,
    manifest,
    requestedTarget: arg('--target'),
    requestedType: arg('--type'),
    requestedAdapter: arg('--adapter'),

    wireCodegraphFlag: has('--no-codegraph')
      ? false
      : has('--codegraph')
        ? true
        : undefined,
    codegraphCandidateKeys,
    interactive: interactiveInit,
  })
  const { target, targets, type } = selection
  const profile = manifest.profiles[type]
  const adapter = selection.adapter
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

  if (has('--dry-run')) {
    console.log(
      JSON.stringify(
        {
          targets,
          type,
          root,
          adapter,
          docsRoot,
          wireCodegraph: selection.wireCodegraph,
          codegraphCandidates: codegraphCandidateKeys,
        },
        null,
        2,
      ),
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

  // Cross-repo index routing: wire per-repo CodeGraph MCP servers when the
  // member opted in. Only the declared machine-local maps are consulted.
  const wire = selection.wireCodegraph
    ? wireCodegraph({ root, filterKeys: codegraphFilter })
    : undefined
  if (wire) reportCodegraphPlan(wire)
  else if (codegraphCandidateKeys.length) {
    console.log(
      `  codegraph: skipped ${codegraphCandidateKeys.length} repo(s) — run \`platform-dna codegraph:wire\` later`,
    )
  }
  const mcpManifest: InstallManifestMcp | undefined = wire?.manifestMcp

  const gitignoreEntries: OwnedGitignoreEntry[] = [...maps.gitignoreEntries]
  if (mcpManifest) {
    // Local MCP config holds absolute machine paths — keep it out of git. It is
    // shared because other toolkits also wire into the same file.
    const mcpIgnore = ensureGitignoreEntries(root, [CODEGRAPH_MCP_FILE])
    if (mcpIgnore.changed) console.log(`  wrote: ${mcpIgnore.file} (${CODEGRAPH_MCP_FILE})`)
    gitignoreEntries.push({ pattern: CODEGRAPH_MCP_FILE, shared: true })
  }

  const harness = installHarness({
    root,
    type,
    adapter,
    force: has('--force'),
    seededMaps: maps.maps,
    gitignoreEntries,
    mcp: mcpManifest,
  })
  for (const file of harness.written) console.log(`  wrote: ${file}`)
  for (const file of harness.unchanged) console.log(`  unchanged: ${file}`)
  for (const file of harness.conflicts) console.log(`  conflict: ${file}`)
  if (harness.conflicts.length) {
    throw new Error('Platform DNA harness conflicts; review files or rerun with explicit --force')
  }

  console.log(`platform-dna init complete: ${type}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
