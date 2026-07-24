import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  statSync,
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
  ensureLocalRepoMaps,
  LEGACY_LOCAL_MAP,
  PLATFORM_LOCAL_MAP,
} from '../dist/install/local-maps.js'
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

test('profile manifest freezes adapters and lane markers', () => {
  assert.equal(manifest.profiles.docs.requiresAdapter, undefined)
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
  assert.deepEqual(manifest.profiles.fe.ownedSkills, ['platform-base'])
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
  assert.deepEqual(packageContract.skillsByType.docs, [
    'legacy',
    'configure-repo-maps',
  ])
  assert.deepEqual(packageContract.skillsByType.fe, [
    'platform-base',
    'legacy',
    'configure-repo-maps',
  ])
  assert.deepEqual(packageContract.skillsByType.be, [
    'legacy',
    'configure-repo-maps',
  ])
  assert.deepEqual(packageContract.ownedRules, [])
})

test('init wizard prompts agents, lane, adapter, then codegraph', async () => {
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
        order.push('agent')
        assert.deepEqual(
          opts.choices.filter((choice) => choice.checked).map((choice) => choice.value),
          ['claude', 'cursor'],
        )
        assert.match(opts.choices.find((choice) => choice.value === 'cursor').name, /detected/)
        return ['cursor', 'claude']
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

  assert.deepEqual(order, ['agent', 'lane', 'adapter', 'codegraph'])
  assert.deepEqual(selection, {
    targets: ['cursor', 'claude'],
    target: 'cursor,claude',
    type: 'fe',
    adapter: 'nextjs',
    wireCodegraph: true,
  })
})

test('init wizard lets the member defer codegraph', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'platform-dna-wizard-skip-'))
  const selection = await resolveInitWizard({
    root,
    manifest,
    interactive: true,
    detectedAgents: ['cursor'],
    codegraphCandidateKeys: ['portal'],
    prompts: {
      async checkbox() {
        return ['cursor']
      },
      async select(opts) {
        if (opts.message.includes('destination lane')) return 'docs'
        return 'later'
      },
    },
  })
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
      async checkbox() {
        return ['cursor']
      },
      async select(opts) {
        messages.push(opts.message)
        return 'docs'
      },
    },
  })
  assert.ok(!messages.some((message) => message.includes('CodeGraph')))
  // cursor selected but no candidates → flag stays true (wire no-ops / empty)
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
      async checkbox() {
        prompts.push('agent')
        return ['cursor']
      },
      async select(opts) {
        prompts.push(opts.message)
        return 'nuxt4'
      },
    },
  })
  assert.deepEqual(prompts, ['agent', 'Select the FE adapter:'])
  assert.equal(selection.type, 'fe')
  assert.equal(selection.adapter, 'nuxt4')
})

for (const [type, adapter] of [
  ['docs', undefined],
  ['fe', 'nuxt4'],
  ['be', 'fastapi'],
  ['tests', undefined],
]) {
  test(`${type} profile validates and syncs DNA harness assets`, () => {
    const root = target(type, adapter)
    validateTarget({
      root,
      type,
      profile: manifest.profiles[type],
      adapter,
    })
    const maps = seedProjectMaps({ root, type, repoName: `${type}-base` })
    assert.ok(maps.written.length > 0)
    const harness = installHarness({
      root,
      type,
      adapter,
      gitignoreEntries: maps.gitignoreEntries,
    })
    assert.equal(harness.conflicts.length, 0)
    assert.equal(existsSync(path.join(root, '.cursor/skills/platform-ai/SKILL.md')), false)
    assert.equal(
      existsSync(path.join(root, '.cursor/skills/platform-base/SKILL.md')),
      type === 'fe' && (adapter === 'nuxt4' || adapter === 'nextjs'),
    )
    assert.equal(
      existsSync(path.join(root, '.cursor/skills/configure-repo-maps/SKILL.md')),
      true,
    )
    const map = JSON.parse(
      readFileSync(path.join(root, 'platform-repos.json'), 'utf8'),
    )
    assert.equal(map.projects[`${type}-base`].root, '.')
    assert.equal(map.projects[`${type}-base`].role, type)
    assert.equal(map.harness, undefined)
    assert.equal(existsSync(path.join(root, 'legacy-repos.json')), false)
    assert.equal(existsSync(path.join(root, PLATFORM_LOCAL_MAP)), true)
    assert.equal(existsSync(path.join(root, LEGACY_LOCAL_MAP)), true)
    const ignore = readFileSync(path.join(root, '.gitignore'), 'utf8')
    assert.match(ignore, /platform-repos\.local\.json/)
    assert.match(ignore, /legacy-repos\.local\.json/)
    assert.match(ignore, /\.cursor\//)
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
    JSON.stringify({ package: '@platform/docskit', types: ['docs'] }),
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
      projects: { docskit: { root: '.', role: 'tooling' } },
    }),
  )
  const toolingRoot = mkdtempSync(path.join(os.tmpdir(), 'platform-dna-role-'))
  writeFileSync(
    path.join(toolingRoot, 'platform-repos.json'),
    JSON.stringify({
      projects: { docskit: { root: '.', role: 'tooling' } },
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

test('DNA profiles no longer bundle specialist package sets', () => {
  assert.equal(manifest.profiles.docs.recommended, undefined)
  assert.equal(manifest.profiles.fe.recommended, undefined)
  assert.equal(manifest.profiles.be.recommended, undefined)
})

test('dotnet adapters validate Line FE and Integration BE', () => {
  const line = target('fe', 'dotnet-line')
  validateTarget({
    root: line,
    type: 'fe',
    profile: manifest.profiles.fe,
    adapter: 'dotnet-line',
  })
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
  assert.equal(output.wireCodegraph, true)
})

test('CLI init --no-codegraph skips wiring when candidates exist', () => {
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
      '--no-codegraph',
    ],
    { cwd: path.resolve('.'), encoding: 'utf8' },
  )
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
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
  // Local-map ignore lines are shared — kept so other toolkits can still use maps.
  assert.match(readFileSync(path.join(root, '.gitignore'), 'utf8'), /platform-repos\.local/)
  assert.match(readFileSync(path.join(root, '.gitignore'), 'utf8'), /legacy-repos\.local/)
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

test('DNA replaces thin /configure-repo-maps copies without --force', () => {
  const root = target('docs')
  const skill = path.join(root, '.cursor/skills/configure-repo-maps/SKILL.md')
  mkdirSync(path.dirname(skill), { recursive: true })
  writeFileSync(
    skill,
    '---\nname: configure-repo-maps\n---\n\n<!-- toolkit:configure-repo-maps-thin -->\n\n# thin vendor copy\n',
  )
  const result = installHarness({ root, type: 'docs' })
  assert.equal(result.conflicts.length, 0, result.conflicts.join('\n'))
  const body = readFileSync(skill, 'utf8')
  assert.match(body, /platform-dna:configure-repo-maps-ssot/)
  assert.doesNotMatch(body, /toolkit:configure-repo-maps-thin/)
})

test('DNA replaces unclean non-SSOT configure-repo-maps without --force', () => {
  const root = target('be', 'fastapi')
  const skill = path.join(root, '.cursor/skills/configure-repo-maps/SKILL.md')
  mkdirSync(path.dirname(skill), { recursive: true })
  writeFileSync(skill, '---\nname: configure-repo-maps\n---\n\n# broken leftover\n')
  const result = installHarness({ root, type: 'be', adapter: 'fastapi' })
  assert.equal(result.conflicts.length, 0, result.conflicts.join('\n'))
  assert.match(readFileSync(skill, 'utf8'), /platform-dna:configure-repo-maps-ssot/)
})

test('BE fastapi multi-agent fans out common skills and gitignores agent dirs', () => {
  const root = target('be', 'fastapi')
  const maps = seedProjectMaps({ root, type: 'be', repoName: 'api' })
  const result = installHarness({
    root,
    type: 'be',
    adapter: 'fastapi',
    targets: ['cursor', 'gemini', 'antigravity'],
    gitignoreEntries: maps.gitignoreEntries,
  })
  assert.equal(result.conflicts.length, 0, result.conflicts.join('\n'))
  for (const dir of ['.cursor', '.gemini', '.agents']) {
    const skill = path.join(root, dir, 'skills/configure-repo-maps/SKILL.md')
    assert.equal(existsSync(skill), true, skill)
    assert.match(readFileSync(skill, 'utf8'), /platform-dna:configure-repo-maps-ssot/)
  }
  const ignore = readFileSync(path.join(root, '.gitignore'), 'utf8')
  assert.match(ignore, /\.cursor\//)
  assert.match(ignore, /\.gemini\//)
  assert.match(ignore, /\.agents\//)
  const manifestFiles = Object.keys(readInstallManifest(root).files)
  assert.ok(manifestFiles.some((f) => f.startsWith('.agents/skills/configure-repo-maps/')))
  assert.ok(manifestFiles.some((f) => f.startsWith('.gemini/skills/configure-repo-maps/')))
})

test('empty directory at skill path does not conflict', () => {
  const root = target('be', 'fastapi')
  const skill = path.join(root, '.cursor/skills/configure-repo-maps/SKILL.md')
  mkdirSync(skill, { recursive: true })
  const result = installHarness({ root, type: 'be', adapter: 'fastapi' })
  assert.equal(result.conflicts.length, 0, result.conflicts.join('\n'))
  assert.ok(statSync(skill).isFile())
  assert.match(readFileSync(skill, 'utf8'), /platform-dna:configure-repo-maps-ssot/)
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

test('installers enforce frozen lockfiles', () => {
  for (const script of [
    readFileSync('install.sh', 'utf8'),
    readFileSync('install.ps1', 'utf8'),
  ]) {
    assert.match(script, /pnpm install --frozen-lockfile/)
    assert.match(script, /npm ci/)
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
  ensureGitignoreEntries(root, ['.platform-dna/', '.cursor/mcp.json'])
  installHarness({
    root,
    type: 'docs',
    gitignoreEntries: [
      { pattern: '.platform-dna/', shared: false },
      { pattern: '.cursor/mcp.json', shared: true },
    ],
  })
  uninstallHarness({ root, yes: true })
  const body = readFileSync(path.join(root, '.gitignore'), 'utf8')
  assert.doesNotMatch(body, /\.platform-dna\//)
  assert.match(body, /\.cursor\/mcp\.json/)
})

test('ensureLocalRepoMaps creates skeletons once and preserves member content + CRLF', () => {
  const root = scratch('local-maps')
  const first = ensureLocalRepoMaps(root)
  assert.deepEqual(first.created.sort(), [LEGACY_LOCAL_MAP, PLATFORM_LOCAL_MAP].sort())
  assert.deepEqual(first.skipped, [])
  const platformBody = readFileSync(path.join(root, PLATFORM_LOCAL_MAP), 'utf8')
  assert.match(platformBody, /"projects": \{\}/)
  assert.equal(existsSync(path.join(root, LEGACY_LOCAL_MAP)), true)

  const member = '{\r\n  "projects": {\r\n    "portal": { "root": "/tmp/portal" }\r\n  }\r\n}\r\n'
  writeFileSync(path.join(root, PLATFORM_LOCAL_MAP), member)
  const second = ensureLocalRepoMaps(root)
  assert.deepEqual(second.created, [])
  assert.deepEqual(second.skipped.sort(), [LEGACY_LOCAL_MAP, PLATFORM_LOCAL_MAP].sort())
  assert.equal(readFileSync(path.join(root, PLATFORM_LOCAL_MAP), 'utf8'), member)

  const ignore = readFileSync(path.join(root, '.gitignore'), 'utf8')
  assert.match(ignore, /platform-repos\.local\.json/)
  assert.match(ignore, /legacy-repos\.local\.json/)
  assert.deepEqual(
    second.gitignoreEntries.map((e) => [e.pattern, e.shared]),
    [
      [PLATFORM_LOCAL_MAP, true],
      [LEGACY_LOCAL_MAP, true],
    ],
  )
})

test('getHarnessStatus reports localMaps without failing when maps are empty', () => {
  const root = target('docs')
  seedProjectMaps({ root, type: 'docs' })
  installHarness({ root, type: 'docs' })
  const status = getHarnessStatus(root)
  assert.ok(Array.isArray(status.localMaps))
  assert.deepEqual(
    status.localMaps.map((entry) => entry.file).sort(),
    [LEGACY_LOCAL_MAP, PLATFORM_LOCAL_MAP].sort(),
  )
  for (const entry of status.localMaps) {
    assert.equal(entry.exists, true)
    assert.equal(entry.empty, true)
    assert.equal(entry.projectCount, 0)
  }

  writeFileSync(
    path.join(root, PLATFORM_LOCAL_MAP),
    JSON.stringify({ projects: { portal: { root: '/tmp/portal' } } }),
  )
  const filled = getHarnessStatus(root)
  const platform = filled.localMaps.find((entry) => entry.file === PLATFORM_LOCAL_MAP)
  assert.ok(platform)
  assert.equal(platform.empty, false)
  assert.equal(platform.projectCount, 1)
  assert.equal(filled.localMaps.find((entry) => entry.file === LEGACY_LOCAL_MAP).empty, true)
})

test('seedProjectMaps upserts current repo only and does not wipe sibling catalog', () => {
  const root = target('docs')
  writeFileSync(
    path.join(root, 'platform-repos.json'),
    JSON.stringify({
      defaultGroup: 'docs',
      groups: {
        docs: { primary: 'other-docs', projects: ['other-docs'] },
        fe: { primary: 'portal', projects: ['portal'] },
      },
      projects: {
        'other-docs': { root: '.', role: 'docs', repo: 'other-docs', write: true },
        portal: {
          role: 'fe',
          repo: 'portal',
          write: false,
          url: 'https://example.com/portal.git',
        },
      },
    }),
  )
  assert.throws(
    () => seedProjectMaps({ root, type: 'docs', repoName: 'docs' }),
    /already maps root "\." as other-docs/,
  )

  const root2 = target('fe', 'nuxt4')
  writeFileSync(
    path.join(root2, 'platform-repos.json'),
    JSON.stringify({
      defaultGroup: 'fe',
      groups: {
        fe: { primary: 'portal', projects: ['portal'] },
        be: { primary: 'api', projects: ['api'] },
      },
      projects: {
        portal: {
          root: '.',
          role: 'fe',
          repo: 'portal',
          write: true,
          url: 'https://example.com/portal.git',
        },
        api: {
          role: 'be',
          repo: 'api',
          write: false,
          url: 'https://example.com/api.git',
        },
      },
    }),
  )
  seedProjectMaps({ root: root2, type: 'fe', repoName: 'portal' })
  const map = JSON.parse(readFileSync(path.join(root2, 'platform-repos.json'), 'utf8'))
  assert.deepEqual(Object.keys(map.projects).sort(), ['api', 'portal'])
  assert.equal(map.projects.api.url, 'https://example.com/api.git')
  assert.equal(map.projects.portal.url, 'https://example.com/portal.git')
  assert.equal(map.projects.portal.root, '.')
  assert.equal(map.groups.be.primary, 'api')
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

test('readRepoRefs prefers platform map on same-key collision; legacy-only keys remain', () => {
  const root = scratch('cg-collision')
  const platformRoot = scratch('cg-collision-platform')
  const legacyDupRoot = scratch('cg-collision-legacy-dup')
  const legacyOnlyRoot = scratch('cg-collision-legacy-only')
  mkdirSync(path.join(platformRoot, '.codegraph'))
  mkdirSync(path.join(legacyOnlyRoot, '.codegraph'))
  writeFileSync(
    path.join(root, 'platform-repos.local.json'),
    JSON.stringify({ projects: { portal: { root: platformRoot } } }),
  )
  writeFileSync(
    path.join(root, 'legacy-repos.local.json'),
    JSON.stringify({
      projects: {
        portal: { root: legacyDupRoot },
        'legacy-erp': { root: legacyOnlyRoot },
      },
    }),
  )

  const refs = readRepoRefs(root)
  const portal = refs.find((ref) => ref.key === 'portal')
  assert.ok(portal)
  assert.equal(portal.root, platformRoot)
  assert.equal(portal.source, 'platform')
  const legacyErp = refs.find((ref) => ref.key === 'legacy-erp')
  assert.ok(legacyErp)
  assert.equal(legacyErp.root, legacyOnlyRoot)
  assert.equal(legacyErp.source, 'legacy')
  assert.equal(refs.length, 2)

  const plan = planCodegraphServers({ root })
  const wiredPortal = plan.wire.find((server) => server.name === 'codegraph-portal')
  assert.ok(wiredPortal)
  assert.equal(wiredPortal.root, path.resolve(platformRoot))
  assert.equal(wiredPortal.source, 'platform')
  assert.ok(plan.wire.some((server) => server.name === 'codegraph-legacy-erp'))
  assert.ok(!plan.wire.some((server) => server.root === path.resolve(legacyDupRoot)))
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
