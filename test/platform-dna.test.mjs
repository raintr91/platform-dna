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
  validateInstallManifest,
} from '../dist/install/harness.js'
import { assertPortableMap, seedProjectMaps } from '../dist/install/maps.js'
import {
  installProfilePackages,
  resolvePackageSet,
} from '../dist/install/packages.js'
import { validateTarget } from '../dist/profile/detect.js'
import { loadProfiles } from '../dist/profile/manifest.js'

const manifest = loadProfiles()

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

test('profile manifest freezes required package sets and supported adapters', () => {
  assert.deepEqual(manifest.profiles.docs.required, [
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
  assert.deepEqual(manifest.profiles.tests.required, ['testkit'])
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
  const docsMetaSkill = readFileSync(
    path.resolve('harness/docs/skills/platform-ai/SKILL.md'),
    'utf8',
  )
  assert.doesNotMatch(docsMetaSkill, /- \[ \]/)
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
    assert.ok(existsSync(path.join(root, '.cursor/rules/platform-ai.mdc')))
    assert.equal(
      existsSync(path.join(root, '.cursor/skills/platform-ai/SKILL.md')),
      type === 'docs',
    )
    assert.equal(
      existsSync(path.join(root, '.cursor/skills/platform-base/SKILL.md')),
      type === 'fe' && (adapter === 'nuxt4' || adapter === 'nextjs'),
    )
    const ids = resolvePackageSet({ manifest, type })
    assert.deepEqual(ids, manifest.profiles[type].required)
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

test('dotnet adapters validate and drop Testkit from Line FE required set', () => {
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
  const root = target('docs')
  installHarness({ root, type: 'docs' })
  const docsSkill = path.join(root, '.cursor/skills/platform-ai/SKILL.md')
  assert.ok(existsSync(docsSkill))

  installHarness({ root, type: 'fe', adapter: 'nuxt4' })
  assert.ok(existsSync(path.join(root, '.cursor/skills/platform-base/SKILL.md')))
  let status = getHarnessStatus(root)
  const stale = status.files.find((file) => file.path === '.cursor/skills/platform-ai/SKILL.md')
  assert.equal(status.type, 'fe')
  assert.equal(stale.state, 'stale')
  assert.equal(stale.status, 'unmodified')
  assert.equal(stale.prunable, true)

  const dryRun = pruneHarness({ root })
  assert.equal(dryRun.dryRun, true)
  assert.deepEqual(dryRun.planned, [docsSkill])
  assert.ok(existsSync(docsSkill))

  writeFileSync(docsSkill, `${readFileSync(docsSkill, 'utf8')}\nmember change\n`)
  status = getHarnessStatus(root)
  assert.equal(
    status.files.find((file) => file.path === '.cursor/skills/platform-ai/SKILL.md').status,
    'modified',
  )
  const protectedResult = pruneHarness({ root, yes: true })
  assert.deepEqual(protectedResult.deleted, [])
  assert.ok(existsSync(docsSkill))

  installHarness({ root, type: 'docs', force: true })
  installHarness({ root, type: 'fe', adapter: 'nuxt4' })
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
  assert.deepEqual(pruned.deleted, [docsSkill])
  assert.equal(existsSync(docsSkill), false)
  for (const file of protectedFiles) assert.ok(existsSync(file))
  assert.equal(
    getHarnessStatus(root).files.some(
      (file) => file.path === '.cursor/skills/platform-ai/SKILL.md',
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
  assert.equal(
    harnessSourceToTarget('harness/fe/rules/platform-ai.mdc'),
    '.cursor/rules/platform-ai.mdc',
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
            source: 'harness/docs/rules/platform-ai.mdc',
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
            source: 'harness/docs/rules/platform-ai.mdc',
            sha256: '0'.repeat(64),
            state: 'stale',
          },
        },
      }),
    /non-DNA or protected path/,
  )

  const root = target('docs')
  installHarness({ root, type: 'docs' })
  const outside = mkdtempSync(path.join(os.tmpdir(), 'platform-dna-outside-'))
  const cursor = path.join(root, '.cursor')
  const movedCursor = path.join(root, '.cursor-real')
  renameSync(cursor, movedCursor)
  symlinkSync(outside, cursor)
  assert.throws(() => getHarnessStatus(root), /crosses a symlink/)
})

test('CLI status and dry-run-by-default prune expose managed lifecycle', () => {
  const root = target('docs')
  installHarness({ root, type: 'docs' })
  installHarness({ root, type: 'tests' })
  const docsSkill = path.join(root, '.cursor/skills/platform-ai/SKILL.md')

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
  assert.ok(existsSync(docsSkill))

  const apply = spawnSync(
    process.execPath,
    ['dist/cli.js', 'prune', '--project-root', root, '--yes'],
    { cwd: path.resolve('.'), encoding: 'utf8' },
  )
  assert.equal(apply.status, 0, apply.stderr)
  assert.equal(existsSync(docsSkill), false)
})

test('installers pin the immutable release and enforce lockfiles', () => {
  for (const script of [
    readFileSync('install.sh', 'utf8'),
    readFileSync('install.ps1', 'utf8'),
  ]) {
    assert.match(script, /v0\.2\.0/)
    assert.match(script, /pnpm install --frozen-lockfile/)
    assert.match(script, /npm ci/)
    assert.doesNotMatch(script, /(?:REF:-main|Ref = "main")/)
  }
})
