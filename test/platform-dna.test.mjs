import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import {
  getHarnessStatus,
  harnessSourceToTarget,
  installHarness,
  pruneHarness,
  readInstallManifest,
  recordManagedExtras,
  uninstallHarness,
  validateInstallManifest,
} from '../dist/install/harness.js'
import {
  canonicalGitignorePattern,
  ensureGitignoreEntries,
  removeGitignoreEntries,
} from '../dist/install/gitignore.js'
import {
  mcpEntryHash,
  mergeMcpServers,
  removeMcpServers,
} from '../dist/install/mcp-config.js'
import {
  isWsl,
  normalizeRuntimePath,
  planCodegraphServers,
  readRepoRefs,
  wireCodegraph,
} from '../dist/install/codegraph.js'
import { assertPortableMap, seedProjectMaps } from '../dist/install/maps.js'
import {
  installProfilePackages,
  resolvePackageSet,
} from '../dist/install/packages.js'
import { resolveInitWizard } from '../dist/install/init-wizard.js'
import { validateTarget } from '../dist/profile/detect.js'
import { loadProfiles } from '../dist/profile/manifest.js'
import {
  discoverInstalls,
  ledgerPath,
  readLedger,
} from '../dist/install/ledger.js'

const manifest = loadProfiles()
const testState = mkdtempSync(path.join(os.tmpdir(), 'platform-dna-state-'))
process.env.PLATFORM_DNA_STATE_DIR = testState

function target(type, adapter) {
  const root = mkdtempSync(path.join(os.tmpdir(), `platform-dna-${type}-`))
  if (type === 'docs') mkdirSync(path.join(root, 'architecture'))
  if (type === 'fe') {
    if (adapter === 'dotnet-line') {
      writeFileSync(path.join(root, 'Line.sln'), '')
    } else {
      writeFileSync(path.join(root, 'package.json'), '{}\n')
      writeFileSync(
        path.join(root, `${adapter === 'nextjs' ? 'next' : 'nuxt'}.config.ts`),
        '',
      )
    }
  }
  if (type === 'be' && adapter === 'fastapi') {
    writeFileSync(
      path.join(root, 'pyproject.toml'),
      '[project]\nname="api"\ndependencies=["fastapi>=0.115"]\n',
    )
  }
  if (type === 'be' && adapter === 'laravel') {
    writeFileSync(path.join(root, 'artisan'), '')
    writeFileSync(
      path.join(root, 'composer.json'),
      JSON.stringify({
        require: {
          'laravel/framework': '^12.0',
          'nwidart/laravel-modules': '^12.0',
        },
      }),
    )
  }
  if (type === 'be' && adapter === 'dotnet-integration') {
    writeFileSync(path.join(root, 'Integration.sln'), '')
  }
  if (type === 'tests') mkdirSync(path.join(root, 'tests'))
  return root
}

test('profile manifest freezes recommended package sets and supported adapters', () => {
  assert.deepEqual(manifest.profiles.docs.recommended, [
    'hubdocs',
    'bundlekit',
    'processkit',
  ])
  assert.deepEqual(manifest.profiles.fe.adapters, [
    'nuxt4',
    'nextjs',
    'dotnet-line',
  ])
  assert.deepEqual(manifest.profiles.be.adapters, [
    'fastapi',
    'laravel',
    'dotnet-integration',
  ])
  assert.deepEqual(manifest.profiles.tests.recommended, ['testkit'])
  const schema = JSON.parse(
    readFileSync(
      path.resolve('templates/schemas/platform-repos.schema.json'),
      'utf8',
    ),
  )
  assert.equal(schema.properties.defaultGroup.enum.includes('tooling'), false)
  assert.equal(
    schema.properties.projects.additionalProperties.properties.role.enum.includes(
      'tooling',
    ),
    false,
  )
  assert.equal(schema.properties.harness, undefined)
  assert.equal(schema.additionalProperties, false)
  const packageContract = JSON.parse(readFileSync('mcp-package.json', 'utf8'))
  assert.deepEqual(packageContract.skillsByType.docs, [])
  assert.deepEqual(packageContract.skillsByType.fe, ['platform-base'])
  assert.deepEqual(packageContract.ownedRules, [])
})

test('init wizard prompts agents, lane, adapter, optional toolkits, then codegraph', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'platform-dna-wizard-'))
  const order = []
  const selection = await resolveInitWizard({
    root,
    manifest,
    interactive: true,
    detectedAgents: ['claude', 'cursor'],
    codegraphCandidateKeys: ['portal', 'api'],
    prompts: {
      async checkbox(opts) {
        if (opts.message.includes('agents')) {
          order.push('agent')
          assert.deepEqual(
            opts.choices.filter((choice) => choice.checked).map((choice) => choice.value),
            ['claude', 'cursor'],
          )
          assert.match(opts.choices.find((choice) => choice.value === 'cursor').name, /detected/)
          return ['cursor', 'claude']
        }
        order.push('optional')
        // FE optional toolkits with install metadata are artifactgraph + hubdocs
        assert.deepEqual(
          opts.choices.map((choice) => choice.value),
          ['artifactgraph', 'hubdocs'],
        )
        return ['artifactgraph']
      },
      async select(opts) {
        if (opts.message.includes('destination lane')) {
          order.push('lane')
          return 'fe'
        }
        if (opts.message.includes('adapter')) {
          order.push('adapter')
          return 'nextjs'
        }
        order.push('codegraph')
        assert.match(opts.message, /2 repo/)
        return 'yes'
      },
    },
  })

  assert.deepEqual(order, ['agent', 'lane', 'adapter', 'optional', 'codegraph'])
  assert.deepEqual(selection, {
    targets: ['cursor', 'claude'],
    target: 'cursor,claude',
    type: 'fe',
    adapter: 'nextjs',
    withOptional: ['artifactgraph'],
    wireCodegraph: true,
  })
})

test('init wizard lets the member skip optional toolkits and defer codegraph', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'platform-dna-wizard-skip-'))
  const selection = await resolveInitWizard({
    root,
    manifest,
    interactive: true,
    detectedAgents: ['cursor'],
    codegraphCandidateKeys: ['portal'],
    prompts: {
      async checkbox(opts) {
        if (opts.message.includes('agents')) return ['cursor']
        return [] // skip optional toolkits — init "trống"
      },
      async select(opts) {
        if (opts.message.includes('destination lane')) return 'docs'
        return 'later' // defer codegraph wiring
      },
    },
  })
  assert.deepEqual(selection.withOptional, [])
  assert.equal(selection.wireCodegraph, false)
})

test('init wizard skips the codegraph step when no repos are declared', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'platform-dna-wizard-nocg-'))
  const messages = []
  const selection = await resolveInitWizard({
    root,
    manifest,
    interactive: true,
    detectedAgents: ['cursor'],
    codegraphCandidateKeys: [],
    prompts: {
      async checkbox(opts) {
        return opts.message.includes('agents') ? ['cursor'] : []
      },
      async select(opts) {
        messages.push(opts.message)
        return 'docs'
      },
    },
  })
  assert.ok(!messages.some((message) => message.includes('CodeGraph')))
  // cursor selected but member never wired anything and there are no candidates
  assert.equal(selection.wireCodegraph, true)
})

test('non-interactive init keeps cursor and docs defaults', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'platform-dna-wizard-default-'))
  const selection = await resolveInitWizard({
    root,
    manifest,
    interactive: false,
    detectedAgents: ['claude'],
  })
  assert.deepEqual(selection, {
    targets: ['cursor'],
    target: 'cursor',
    type: 'docs',
    adapter: undefined,
    withOptional: [],
    wireCodegraph: true,
  })
})

test('declared project role locks the interactive lane', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'platform-dna-wizard-role-'))
  writeFileSync(
    path.join(root, 'platform-repos.json'),
    JSON.stringify({ projects: { portal: { root: '.', role: 'portal' } } }),
  )
  const prompts = []
  const selection = await resolveInitWizard({
    root,
    manifest,
    interactive: true,
    detectedAgents: ['cursor'],
    codegraphCandidateKeys: [],
    prompts: {
      async checkbox(opts) {
        prompts.push(opts.message.includes('agents') ? 'agent' : 'optional')
        return opts.message.includes('agents') ? ['cursor'] : []
      },
      async select(opts) {
        prompts.push(opts.message)
        return 'nuxt4'
      },
    },
  })
  // No lane prompt (locked by role); no codegraph prompt (no candidates).
  assert.deepEqual(prompts, ['agent', 'Select the FE adapter:', 'optional'])
  assert.equal(selection.type, 'fe')
  assert.equal(selection.adapter, 'nuxt4')
})

for (const [type, adapter] of [
  ['docs', undefined],
  ['fe', 'nuxt4'],
  ['be', 'fastapi'],
  ['tests', undefined],
]) {
  test(`${type} profile validates, syncs only DNA assets, and plans package init`, () => {
    const root = target(type, adapter)
    validateTarget({
      root,
      type,
      profile: manifest.profiles[type],
      adapter,
    })
    const maps = seedProjectMaps({ root, type, repoName: `${type}-base` })
    assert.ok(maps.written.length > 0)
    const harness = installHarness({ root, type, adapter })
    assert.equal(harness.conflicts.length, 0)
    assert.equal(existsSync(path.join(root, '.cursor/skills/platform-ai/SKILL.md')), false)
    assert.equal(
      existsSync(path.join(root, '.cursor/skills/platform-base/SKILL.md')),
      type === 'fe' && (adapter === 'nuxt4' || adapter === 'nextjs'),
    )
    const ids = resolvePackageSet({ manifest, type })
    assert.deepEqual(ids, manifest.profiles[type].recommended)
    const plan = installProfilePackages({
      manifest,
      type,
      packageIds: ids,
      projectRoot: root,
      adapter,
      dryRun: true,
    })
    assert.ok(plan.length >= ids.length)
    const map = JSON.parse(
      readFileSync(path.join(root, 'platform-repos.json'), 'utf8'),
    )
    assert.equal(map.projects[`${type}-base`].root, '.')
    assert.equal(map.projects[`${type}-base`].role, type)
    assert.equal(map.harness, undefined)
    assert.equal(existsSync(path.join(root, 'legacy-repos.json')), false)
  })
}

test('lane mismatch and adapter mismatch fail fast without force', () => {
  const root = target('docs')
  seedProjectMaps({ root, type: 'docs', repoName: 'docs' })
  assert.throws(
    () =>
      validateTarget({
        root,
        type: 'fe',
        profile: manifest.profiles.fe,
        adapter: 'nuxt4',
      }),
    /declares role=docs/,
  )
  const fe = target('fe', 'nuxt4')
  assert.throws(
    () =>
      validateTarget({
        root: fe,
        type: 'fe',
        profile: manifest.profiles.fe,
        adapter: 'nextjs',
      }),
    /Selected nextjs/,
  )
})

test('non-portable committed maps are rejected; local maps are ignored', () => {
  const root = target('docs')
  const file = path.join(root, 'platform-repos.json')
  writeFileSync(file, JSON.stringify({ projects: { portal: { root: '../portal' } } }))
  assert.throws(() => assertPortableMap(file), /machine\/sibling path/)
  writeFileSync(path.join(root, 'platform-repos.local.json'), '{"root":"/home/member/x"}')
  assert.doesNotThrow(() => assertPortableMap(path.join(root, 'missing.json')))
})

test('platform map migration removes obsolete toolkit inventory', () => {
  const root = target('docs')
  writeFileSync(
    path.join(root, 'platform-repos.json'),
    JSON.stringify({
      defaultGroup: 'docs',
      harness: { profiles: { docs: { groups: ['docs'], skills: ['platform-ai', 'spec'] } } },
      groups: {},
      projects: {},
    }),
  )
  seedProjectMaps({ root, type: 'docs', repoName: 'docs' })
  const map = JSON.parse(readFileSync(path.join(root, 'platform-repos.json'), 'utf8'))
  assert.equal(map.harness, undefined)
  assert.deepEqual(Object.keys(map.projects), ['docs'])
})

test('rejects MCP tooling package repos and the removed tooling profile', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'platform-dna-mcp-'))
  writeFileSync(
    path.join(root, 'mcp-package.json'),
    JSON.stringify({ package: '@platform/hubdocs', types: ['docs'] }),
  )
  assert.throws(
    () =>
      validateTarget({
        root,
        type: 'docs',
        profile: manifest.profiles.docs,
      }),
    /MCP package|MCP tooling/,
  )
  writeFileSync(
    path.join(root, 'platform-repos.json'),
    JSON.stringify({
      projects: { hubdocs: { root: '.', role: 'tooling' } },
    }),
  )
  const toolingRoot = mkdtempSync(path.join(os.tmpdir(), 'platform-dna-role-'))
  writeFileSync(
    path.join(toolingRoot, 'platform-repos.json'),
    JSON.stringify({
      projects: { hubdocs: { root: '.', role: 'tooling' } },
    }),
  )
  assert.throws(
    () =>
      validateTarget({
        root: toolingRoot,
        type: 'docs',
        profile: manifest.profiles.docs,
      }),
    /role=tooling/,
  )
  assert.equal(manifest.profiles.tooling, undefined)
})

test('optional packages require declaration and install metadata', () => {
  assert.deepEqual(
    resolvePackageSet({
      manifest,
      type: 'docs',
      withOptional: ['artifactgraph'],
    }),
    ['hubdocs', 'bundlekit', 'processkit', 'artifactgraph'],
  )
  assert.throws(
    () =>
      resolvePackageSet({
        manifest,
        type: 'docs',
        withOptional: ['testkit'],
      }),
    /not an optional package/,
  )
})

test('FE docs pointer is forwarded to Codegenkit and Hubdocs consumer profile', () => {
  const root = target('fe', 'nuxt4')
  const docsRoot = target('docs')
  const packageIds = resolvePackageSet({
    manifest,
    type: 'fe',
    adapter: 'nuxt4',
    withOptional: ['hubdocs'],
  })
  const plan = installProfilePackages({
    manifest,
    type: 'fe',
    packageIds,
    projectRoot: root,
    target: 'cursor,claude',
    adapter: 'nuxt4',
    docsRoot,
    dryRun: true,
  })

  const codegen = plan.find((step) => step.packageId === 'codegenkit')
  assert.ok(codegen.argv.includes(`--docs-root=${docsRoot}`))
  const hubdocs = plan.filter((step) => step.packageId === 'hubdocs')
  assert.equal(hubdocs.length, 2)
  assert.ok(hubdocs[0].argv.includes('--target=cursor,claude'))
  assert.ok(hubdocs[0].argv.includes(`--docs-root=${docsRoot}`))
  assert.ok(hubdocs[1].argv.includes('--type=consumer'))
  const processkit = plan.find((step) => step.packageId === 'processkit')
  assert.ok(processkit.argv.includes('--target=cursor,claude'))
})

test('dotnet adapters validate and drop Testkit from Line FE recommended set', () => {
  const line = target('fe', 'dotnet-line')
  validateTarget({
    root: line,
    type: 'fe',
    profile: manifest.profiles.fe,
    adapter: 'dotnet-line',
  })
  assert.deepEqual(
    resolvePackageSet({
      manifest,
      type: 'fe',
      adapter: 'dotnet-line',
    }),
    ['codegenkit', 'processkit'],
  )
  writeFileSync(
    path.join(line, 'platform-repos.json'),
    JSON.stringify({
      projects: { line: { root: '.', role: 'client' } },
    }),
  )
  validateTarget({
    root: line,
    type: 'fe',
    profile: manifest.profiles.fe,
    adapter: 'dotnet-line',
  })

  const integration = target('be', 'dotnet-integration')
  validateTarget({
    root: integration,
    type: 'be',
    profile: manifest.profiles.be,
    adapter: 'dotnet-integration',
  })
})

test('profile switches mark old DNA assets stale and prune only unmodified files', () => {
  const root = target('fe', 'nuxt4')
  installHarness({ root, type: 'fe', adapter: 'nuxt4' })
  const platformBase = path.join(root, '.cursor/skills/platform-base/SKILL.md')
  assert.ok(existsSync(platformBase))

  installHarness({ root, type: 'docs' })
  let status = getHarnessStatus(root)
  const stale = status.files.find((file) => file.path === '.cursor/skills/platform-base/SKILL.md')
  assert.equal(status.type, 'docs')
  assert.equal(stale.state, 'stale')
  assert.equal(stale.status, 'unmodified')
  assert.equal(stale.prunable, true)

  const dryRun = pruneHarness({ root })
  assert.equal(dryRun.dryRun, true)
  assert.deepEqual(dryRun.planned, [platformBase])
  assert.ok(existsSync(platformBase))

  writeFileSync(platformBase, `${readFileSync(platformBase, 'utf8')}\nmember change\n`)
  status = getHarnessStatus(root)
  assert.equal(
    status.files.find((file) => file.path === '.cursor/skills/platform-base/SKILL.md').status,
    'modified',
  )
  const protectedResult = pruneHarness({ root, yes: true })
  assert.deepEqual(protectedResult.deleted, [])
  assert.ok(existsSync(platformBase))

  installHarness({ root, type: 'fe', adapter: 'nuxt4', force: true })
  installHarness({ root, type: 'docs' })
  const protectedFiles = [
    path.join(root, 'platform-repos.json'),
    path.join(root, 'legacy-repos.local.json'),
    path.join(root, '.gitignore'),
    path.join(root, '.cursor/rules/specialist-package.mdc'),
  ]
  for (const file of protectedFiles) {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, 'member or specialist owned\n')
  }
  const pruned = pruneHarness({ root, yes: true })
  assert.deepEqual(pruned.deleted, [platformBase])
  assert.equal(existsSync(platformBase), false)
  for (const file of protectedFiles) assert.ok(existsSync(file))
  assert.equal(
    getHarnessStatus(root).files.some(
      (file) => file.path === '.cursor/skills/platform-base/SKILL.md',
    ),
    false,
  )
})

test('adapter overlay source maps to .cursor skills path', () => {
  assert.equal(
    harnessSourceToTarget(
      'harness/fe/adapters/nuxt4/skills/platform-base/SKILL.md',
    ),
    '.cursor/skills/platform-base/SKILL.md',
  )
  assert.doesNotThrow(() =>
    validateInstallManifest({
      schemaVersion: 1,
      package: '@platform/platform-dna',
      packageVersion: '0.2.0',
      type: 'fe',
      harnessApi: 1,
      files: {
        '.cursor/skills/platform-base/SKILL.md': {
          source: 'harness/fe/adapters/nuxt4/skills/platform-base/SKILL.md',
          sha256: '0'.repeat(64),
          state: 'active',
        },
      },
    }),
  )
})

test('manifest compatibility and path containment reject unsafe prune inputs', () => {
  const valid = {
    schemaVersion: 1,
    package: '@platform/platform-dna',
    packageVersion: '0.1.2',
    type: 'docs',
    harnessApi: 1,
    files: {},
  }
  assert.doesNotThrow(() => validateInstallManifest(valid))
  assert.throws(
    () => validateInstallManifest({ ...valid, schemaVersion: 2 }),
    /schemaVersion/,
  )
  assert.throws(
    () =>
      validateInstallManifest({
        ...valid,
        files: {
          '../.gitignore': {
            source: 'harness/fe/adapters/nuxt4/skills/platform-base/SKILL.md',
            sha256: '0'.repeat(64),
            state: 'stale',
          },
        },
      }),
    /file path/,
  )
  assert.throws(
    () =>
      validateInstallManifest({
        ...valid,
        files: {
          'platform-repos.json': {
            source: 'harness/fe/adapters/nuxt4/skills/platform-base/SKILL.md',
            sha256: '0'.repeat(64),
            state: 'stale',
          },
        },
      }),
    /non-DNA or protected path/,
  )

  const root = target('fe', 'nuxt4')
  installHarness({ root, type: 'fe', adapter: 'nuxt4' })
  const outside = mkdtempSync(path.join(os.tmpdir(), 'platform-dna-outside-'))
  const cursor = path.join(root, '.cursor')
  const movedCursor = path.join(root, '.cursor-real')
  renameSync(cursor, movedCursor)
  symlinkSync(outside, cursor)
  assert.throws(() => getHarnessStatus(root), /crosses a symlink/)
})

test('CLI status and dry-run-by-default prune expose managed lifecycle', () => {
  const root = target('fe', 'nuxt4')
  installHarness({ root, type: 'fe', adapter: 'nuxt4' })
  installHarness({ root, type: 'docs' })
  const platformBase = path.join(root, '.cursor/skills/platform-base/SKILL.md')

  const status = spawnSync(
    process.execPath,
    ['dist/cli.js', 'status', '--project-root', root],
    { cwd: path.resolve('.'), encoding: 'utf8' },
  )
  assert.equal(status.status, 0, status.stderr)
  assert.match(status.stdout, /"state": "stale"/)
  assert.match(status.stdout, /"prunable": true/)

  const dryRun = spawnSync(
    process.execPath,
    ['dist/cli.js', 'prune', '--project-root', root],
    { cwd: path.resolve('.'), encoding: 'utf8' },
  )
  assert.equal(dryRun.status, 0, dryRun.stderr)
  assert.match(dryRun.stdout, /dry-run \(pass --yes to delete\)/)
  assert.ok(existsSync(platformBase))

  const apply = spawnSync(
    process.execPath,
    ['dist/cli.js', 'prune', '--project-root', root, '--yes'],
    { cwd: path.resolve('.'), encoding: 'utf8' },
  )
  assert.equal(apply.status, 0, apply.stderr)
  assert.equal(existsSync(platformBase), false)
})

test('CLI init --yes keeps the legacy cursor target default', () => {
  const root = target('docs')
  const result = spawnSync(
    process.execPath,
    ['dist/cli.js', 'init', '--project-root', root, '--dry-run', '--yes'],
    { cwd: path.resolve('.'), encoding: 'utf8' },
  )
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.deepEqual(output.targets, ['cursor'])
  assert.equal(output.type, 'docs')
  assert.ok(
    output.invocations
      .flatMap((step) => step.argv)
      .filter((value) => value.startsWith('--target='))
      .every((value) => value === '--target=cursor'),
  )
  assert.deepEqual(output.withOptional, [])
})

test('CLI init --with adds optional toolkits and --no-codegraph skips wiring', () => {
  const root = target('docs')
  const other = scratch('cli-with-other')
  mkdirSync(path.join(other, '.codegraph'))
  writeFileSync(
    path.join(root, 'platform-repos.local.json'),
    JSON.stringify({ projects: { portal: { root: other } } }),
  )
  const result = spawnSync(
    process.execPath,
    [
      'dist/cli.js',
      'init',
      '--project-root',
      root,
      '--dry-run',
      '--yes',
      '--with=artifactgraph',
      '--no-codegraph',
    ],
    { cwd: path.resolve('.'), encoding: 'utf8' },
  )
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.deepEqual(output.withOptional, ['artifactgraph'])
  assert.ok(output.packageIds.includes('artifactgraph'))
  assert.equal(output.wireCodegraph, false)
  assert.deepEqual(output.codegraphCandidates, ['portal'])
})

test('install ledger records installs, discovery recovers them, and deinit forgets', () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), 'platform-dna-discover-'))
  const root = path.join(workspace, 'docs')
  mkdirSync(root)
  installHarness({ root, type: 'docs' })

  assert.ok(readLedger().includes(root))
  assert.deepEqual(discoverInstalls(workspace), [root])
  assert.ok(existsSync(ledgerPath()))

  uninstallHarness({ root, yes: true })
  assert.equal(readLedger().includes(root), false)
})

test('deinit removes only manifest-owned unchanged maps and preserves modified maps', () => {
  const root = target('fe', 'nuxt4')
  const maps = seedProjectMaps({ root, type: 'fe', repoName: 'portal' })
  installHarness({
    root,
    type: 'fe',
    adapter: 'nuxt4',
    seededMaps: maps.maps,
    gitignoreEntries: maps.gitignoreEntries,
  })
  const managed = readInstallManifest(root)
  assert.ok(managed.maps['platform-repos.json'])

  const platformMap = path.join(root, 'platform-repos.json')
  const exampleMap = path.join(root, 'platform-repos.example.json')
  writeFileSync(platformMap, `${readFileSync(platformMap, 'utf8')}\n`)

  const preview = uninstallHarness({ root })
  assert.ok(preview.preservedModified.includes(platformMap))
  assert.ok(preview.wouldDelete.includes(exampleMap))
  assert.ok(existsSync(exampleMap))

  const applied = uninstallHarness({ root, yes: true })
  assert.ok(applied.preservedModified.includes(platformMap))
  assert.ok(existsSync(platformMap))
  assert.equal(existsSync(exampleMap), false)
  assert.equal(existsSync(path.join(root, '.cursor/skills/platform-base/SKILL.md')), false)
  assert.equal(existsSync(path.join(root, '.platform-dna/install-manifest.json')), false)
  assert.doesNotMatch(readFileSync(path.join(root, '.gitignore'), 'utf8'), /platform-repos\.local/)
})

test('deinit preserves a project map that predated Platform DNA ownership', () => {
  const root = target('docs')
  writeFileSync(
    path.join(root, 'platform-repos.json'),
    JSON.stringify({ defaultGroup: 'docs', groups: {}, projects: {} }),
  )
  const maps = seedProjectMaps({ root, type: 'docs', repoName: 'docs' })
  installHarness({
    root,
    type: 'docs',
    seededMaps: maps.maps,
    gitignoreEntries: maps.gitignoreEntries,
  })
  assert.equal(readInstallManifest(root).maps['platform-repos.json'], undefined)

  uninstallHarness({ root, yes: true })
  assert.ok(existsSync(path.join(root, 'platform-repos.json')))
})

test('CLI contract: deinit is local and uninstall is global dry-run by default', () => {
  const root = target('docs')
  installHarness({ root, type: 'docs' })
  const deinit = spawnSync(
    process.execPath,
    ['dist/cli.js', 'deinit', '--project-root', root, '--yes'],
    {
      cwd: path.resolve('.'),
      encoding: 'utf8',
      env: { ...process.env, PLATFORM_DNA_STATE_DIR: testState },
    },
  )
  assert.equal(deinit.status, 0, deinit.stderr)
  assert.match(deinit.stdout, /Uninstalled \(repo\)/)

  const fakeHome = mkdtempSync(path.join(os.tmpdir(), 'platform-dna-home-'))
  const global = spawnSync(process.execPath, ['dist/cli.js', 'uninstall'], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: fakeHome,
      PLATFORM_DNA_STATE_DIR: path.join(fakeHome, 'state'),
      PLATFORM_DNA_INSTALL_DIR: path.join(fakeHome, 'bootstrap'),
      PLATFORM_DNA_BIN_DIR: path.join(fakeHome, 'bin'),
    },
  })
  assert.equal(global.status, 0, global.stderr)
  assert.match(global.stdout, /Dry-run \(all\)/)
})

test('global uninstall applies ledger repo and CLI removal from another directory', () => {
  const root = target('docs')
  installHarness({ root, type: 'docs' })
  const fakeHome = mkdtempSync(path.join(os.tmpdir(), 'platform-dna-global-'))
  const state = path.join(fakeHome, 'state')
  const installDir = path.join(fakeHome, 'bootstrap')
  const binDir = path.join(fakeHome, 'bin')
  mkdirSync(state, { recursive: true })
  mkdirSync(installDir, { recursive: true })
  mkdirSync(binDir, { recursive: true })
  writeFileSync(
    path.join(state, 'installs.json'),
    `${JSON.stringify({ version: 1, repos: [root] })}\n`,
  )
  writeFileSync(path.join(installDir, 'package.json'), '{}\n')
  writeFileSync(path.join(binDir, 'platform-dna'), 'shim\n')

  const result = spawnSync(process.execPath, [path.resolve('dist/cli.js'), 'uninstall', '--yes'], {
    cwd: fakeHome,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: fakeHome,
      PLATFORM_DNA_STATE_DIR: state,
      PLATFORM_DNA_INSTALL_DIR: installDir,
      PLATFORM_DNA_BIN_DIR: binDir,
    },
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Uninstalled \(all\)/)
  assert.equal(existsSync(path.join(root, '.platform-dna/install-manifest.json')), false)
  assert.equal(existsSync(installDir), false)
  assert.equal(existsSync(path.join(binDir, 'platform-dna')), false)
  assert.equal(existsSync(path.join(state, 'installs.json')), false)
})

test('installers pin the immutable release and enforce lockfiles', () => {
  const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
  for (const script of [
    readFileSync('install.sh', 'utf8'),
    readFileSync('install.ps1', 'utf8'),
  ]) {
    // Installers must pin the tag of the version being released.
    assert.match(script, new RegExp(`v${version.replace(/\./g, '\\.')}`))
    assert.match(script, /pnpm install --frozen-lockfile/)
    assert.match(script, /npm ci/)
    assert.doesNotMatch(script, /(?:REF:-main|Ref = "main")/)
  }
})

function scratch(prefix) {
  return mkdtempSync(path.join(os.tmpdir(), `platform-dna-${prefix}-`))
}

test('ensureGitignoreEntries creates the file when missing and is idempotent', () => {
  const root = scratch('gi-new')
  const first = ensureGitignoreEntries(root, ['platform-repos.local.json'])
  assert.equal(first.changed, true)
  assert.deepEqual(first.added, ['platform-repos.local.json'])
  assert.equal(
    readFileSync(path.join(root, '.gitignore'), 'utf8'),
    'platform-repos.local.json\n',
  )
  const second = ensureGitignoreEntries(root, ['platform-repos.local.json'])
  assert.equal(second.changed, false)
  assert.deepEqual(second.added, [])
})

test('ensureGitignoreEntries treats .cursor/ and /.cursor/ as equivalent', () => {
  assert.equal(canonicalGitignorePattern('/.cursor/'), canonicalGitignorePattern('.cursor'))
  const root = scratch('gi-equiv')
  writeFileSync(path.join(root, '.gitignore'), '/.cursor/\n')
  const result = ensureGitignoreEntries(root, ['.cursor/', 'dist'])
  assert.deepEqual(result.added, ['dist'])
  assert.equal(readFileSync(path.join(root, '.gitignore'), 'utf8'), '/.cursor/\ndist\n')
})

test('ensureGitignoreEntries preserves member content and CRLF EOL', () => {
  const root = scratch('gi-crlf')
  writeFileSync(path.join(root, '.gitignore'), 'node_modules\r\n.env\r\n')
  const result = ensureGitignoreEntries(root, ['platform-repos.local.json'])
  assert.equal(result.changed, true)
  const body = readFileSync(path.join(root, '.gitignore'), 'utf8')
  assert.equal(body, 'node_modules\r\n.env\r\nplatform-repos.local.json\r\n')
})

test('ensureGitignoreEntries appends a newline before adding to a no-trailing-newline file', () => {
  const root = scratch('gi-nonl')
  writeFileSync(path.join(root, '.gitignore'), 'node_modules')
  ensureGitignoreEntries(root, ['dist'])
  assert.equal(readFileSync(path.join(root, '.gitignore'), 'utf8'), 'node_modules\ndist\n')
})

test('removeGitignoreEntries removes only the targeted lines', () => {
  const root = scratch('gi-remove')
  writeFileSync(path.join(root, '.gitignore'), 'node_modules\nplatform-repos.local.json\n.env\n')
  const result = removeGitignoreEntries(root, ['platform-repos.local.json'])
  assert.deepEqual(result.removed, ['platform-repos.local.json'])
  assert.equal(readFileSync(path.join(root, '.gitignore'), 'utf8'), 'node_modules\n.env\n')
})

test('two toolkits needing .cursor/ do not duplicate the entry', () => {
  const root = scratch('gi-shared')
  ensureGitignoreEntries(root, ['.cursor/mcp.json'])
  const second = ensureGitignoreEntries(root, ['.cursor/mcp.json'])
  assert.equal(second.changed, false)
  const lines = readFileSync(path.join(root, '.gitignore'), 'utf8').trim().split('\n')
  assert.equal(lines.filter((line) => line === '.cursor/mcp.json').length, 1)
})

test('deinit removes exclusive ignore entries but keeps shared ones', () => {
  const root = target('docs')
  ensureGitignoreEntries(root, ['platform-repos.local.json', '.cursor/mcp.json'])
  installHarness({
    root,
    type: 'docs',
    gitignoreEntries: [
      { pattern: 'platform-repos.local.json', shared: false },
      { pattern: '.cursor/mcp.json', shared: true },
    ],
  })
  uninstallHarness({ root, yes: true })
  const body = readFileSync(path.join(root, '.gitignore'), 'utf8')
  assert.doesNotMatch(body, /platform-repos\.local\.json/)
  assert.match(body, /\.cursor\/mcp\.json/)
})

test('mergeMcpServers preserves member entries and is idempotent', () => {
  const root = scratch('mcp-merge')
  const file = path.join(root, '.cursor', 'mcp.json')
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(
    file,
    JSON.stringify({ mcpServers: { member: { command: 'x', args: [] } } }, null, 2),
  )
  const first = mergeMcpServers(file, {
    'codegraph-portal': { command: 'codegraph', args: ['mcp', '--project-root', '/repo'] },
  })
  assert.deepEqual(first.added, ['codegraph-portal'])
  const parsed = JSON.parse(readFileSync(file, 'utf8'))
  assert.ok(parsed.mcpServers.member)
  assert.ok(parsed.mcpServers['codegraph-portal'])

  const second = mergeMcpServers(file, {
    'codegraph-portal': { command: 'codegraph', args: ['mcp', '--project-root', '/repo'] },
  })
  assert.deepEqual(second.unchanged, ['codegraph-portal'])
  assert.deepEqual(second.added, [])
})

test('removeMcpServers keeps member-modified entries and drops matching ones', () => {
  const root = scratch('mcp-remove')
  const file = path.join(root, '.cursor', 'mcp.json')
  mkdirSync(path.dirname(file), { recursive: true })
  const entry = { command: 'codegraph', args: ['mcp', '--project-root', '/repo'] }
  const merge = mergeMcpServers(file, { 'codegraph-a': entry, 'codegraph-b': entry })

  const bag = JSON.parse(readFileSync(file, 'utf8'))
  bag.mcpServers['codegraph-b'].args.push('--edited')
  writeFileSync(file, JSON.stringify(bag, null, 2))

  const result = removeMcpServers(file, merge.hashes)
  assert.deepEqual(result.removed, ['codegraph-a'])
  assert.deepEqual(result.preservedModified, ['codegraph-b'])
  const after = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(after.mcpServers['codegraph-a'], undefined)
  assert.ok(after.mcpServers['codegraph-b'])
})

test('normalizeRuntimePath handles WSL, Windows, and fail-closed cases', () => {
  const prev = process.env.WSL_DISTRO_NAME
  process.env.WSL_DISTRO_NAME = 'Ubuntu'
  assert.equal(normalizeRuntimePath('D:\\code\\portal').path, '/mnt/d/code/portal')
  assert.equal(normalizeRuntimePath('/home/vutv/portal').path, '/home/vutv/portal')
  if (prev !== undefined) process.env.WSL_DISTRO_NAME = prev
  else delete process.env.WSL_DISTRO_NAME

  // A Windows drive path is only usable when this runtime is WSL or Windows;
  // on plain Linux it must fail closed rather than be written verbatim.
  const windowsPath = normalizeRuntimePath('D:\\code\\portal')
  if (isWsl() || process.platform === 'win32') {
    assert.ok(windowsPath.path)
  } else {
    assert.ok(windowsPath.error)
  }
})

test('readRepoRefs reads both local maps and planCodegraphServers filters + normalizes', () => {
  const root = scratch('cg-plan')
  const other = scratch('cg-other')
  mkdirSync(path.join(other, '.codegraph'))
  const missing = path.join(root, 'does-not-exist')
  writeFileSync(
    path.join(root, 'platform-repos.local.json'),
    JSON.stringify({ projects: { portal: { root: other }, ghost: { root: missing } } }),
  )
  writeFileSync(
    path.join(root, 'legacy-repos.local.json'),
    JSON.stringify({ projects: { legacy: { root: other } } }),
  )
  const refs = readRepoRefs(root)
  assert.equal(refs.length, 3)

  const plan = planCodegraphServers({ root })
  const portal = plan.wire.find((server) => server.name === 'codegraph-portal')
  assert.ok(portal)
  assert.equal(portal.root, path.resolve(other))
  assert.equal(portal.hasIndex, true)
  assert.ok(plan.skipped.some((server) => server.name === 'codegraph-ghost'))

  const filtered = planCodegraphServers({ root, filterKeys: ['portal'] })
  assert.deepEqual(
    filtered.wire.map((server) => server.name),
    ['codegraph-portal'],
  )
})

test('planCodegraphServers excludes the current repo and never wires un-indexed repos', () => {
  const root = scratch('cg-self')
  const other = scratch('cg-self-other')
  writeFileSync(
    path.join(root, 'platform-repos.local.json'),
    JSON.stringify({ projects: { self: { root }, other: { root: other } } }),
  )
  const plan = planCodegraphServers({ root })
  assert.ok(plan.skipped.some((server) => server.name === 'codegraph-self'))
  // `other` exists but has no `.codegraph/`: reported for indexing, never wired.
  const needs = plan.needsIndex.find((item) => item.key === 'other')
  assert.ok(needs)
  assert.equal(needs.hint, `cd ${path.resolve(other)} && codegraph init`)
  assert.ok(!plan.wire.some((server) => server.name === 'codegraph-other'))
})

test('un-indexed repos are not merged into mcp.json; indexed repos still wire', () => {
  const root = scratch('cg-gate')
  const indexed = scratch('cg-gate-indexed')
  const bare = scratch('cg-gate-bare')
  mkdirSync(path.join(indexed, '.codegraph'))
  writeFileSync(
    path.join(root, 'platform-repos.local.json'),
    JSON.stringify({ projects: { indexed: { root: indexed }, bare: { root: bare } } }),
  )
  const wire = wireCodegraph({ root })
  assert.deepEqual(
    wire.plan.wire.map((server) => server.name),
    ['codegraph-indexed'],
  )
  assert.ok(wire.plan.needsIndex.some((item) => item.key === 'bare'))
  const parsed = JSON.parse(readFileSync(path.join(root, '.cursor', 'mcp.json'), 'utf8'))
  assert.ok(parsed.mcpServers['codegraph-indexed'])
  assert.equal(parsed.mcpServers['codegraph-bare'], undefined)
})

test('wireCodegraph writes owned servers and deinit unwires exactly those', () => {
  const root = target('docs')
  const other = scratch('cg-wire-other')
  mkdirSync(path.join(other, '.codegraph'))
  writeFileSync(
    path.join(root, 'platform-repos.local.json'),
    JSON.stringify({ projects: { portal: { root: other } } }),
  )
  installHarness({ root, type: 'docs' })
  const wire = wireCodegraph({ root })
  assert.deepEqual(wire.merge.added, ['codegraph-portal'])
  recordManagedExtras(root, {
    gitignore: [{ pattern: '.cursor/mcp.json', shared: true }],
    mcp: wire.manifestMcp,
  })

  const status = getHarnessStatus(root)
  assert.deepEqual(
    status.mcp.map((server) => [server.name, server.status]),
    [['codegraph-portal', 'unmodified']],
  )

  const mcpFile = path.join(root, '.cursor', 'mcp.json')
  assert.ok(JSON.parse(readFileSync(mcpFile, 'utf8')).mcpServers['codegraph-portal'])
  uninstallHarness({ root, yes: true })
  assert.equal(existsSync(mcpFile) ? JSON.parse(readFileSync(mcpFile, 'utf8')).mcpServers?.['codegraph-portal'] : undefined, undefined)
})

test('codegraph:wire CLI is idempotent and reports repos needing an index', () => {
  const root = target('docs')
  const indexed = scratch('cg-cli-indexed')
  const bare = scratch('cg-cli-bare')
  mkdirSync(path.join(indexed, '.codegraph'))
  writeFileSync(
    path.join(root, 'platform-repos.local.json'),
    JSON.stringify({ projects: { indexed: { root: indexed }, bare: { root: bare } } }),
  )
  installHarness({ root, type: 'docs' })

  const run = () =>
    spawnSync(process.execPath, ['dist/cli.js', 'codegraph:wire', '--project-root', root], {
      cwd: path.resolve('.'),
      encoding: 'utf8',
      env: { ...process.env, PLATFORM_DNA_STATE_DIR: testState },
    })
  const first = run()
  assert.equal(first.status, 0, first.stderr)
  assert.match(first.stdout, /wired codegraph-indexed/)
  assert.match(first.stdout, /bare has no index yet/)

  const manifest = readInstallManifest(root)
  assert.ok(manifest.mcp.servers['codegraph-indexed'])
  const second = run()
  assert.equal(second.status, 0, second.stderr)
  assert.match(second.stdout, /unchanged codegraph-indexed/)
})
