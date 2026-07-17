import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { installHarness } from '../dist/install/harness.js'
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
    writeFileSync(path.join(root, 'package.json'), '{}\n')
    writeFileSync(path.join(root, `${adapter === 'nextjs' ? 'next' : 'nuxt'}.config.ts`), '')
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
  if (type === 'tests') mkdirSync(path.join(root, 'tests'))
  return root
}

test('profile manifest freezes required package sets and supported adapters', () => {
  assert.deepEqual(manifest.profiles.docs.required, [
    'hubdocs',
    'bundlekit',
    'processkit',
  ])
  assert.deepEqual(manifest.profiles.fe.adapters, ['nuxt4', 'nextjs'])
  assert.deepEqual(manifest.profiles.be.adapters, ['fastapi', 'laravel'])
  assert.deepEqual(manifest.profiles.tests.required, ['testkit'])
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
    const harness = installHarness({ root, type })
    assert.equal(harness.conflicts.length, 0)
    assert.ok(existsSync(path.join(root, '.cursor/rules/platform-ai.mdc')))
    assert.equal(
      existsSync(path.join(root, '.cursor/skills/platform-ai/SKILL.md')),
      type === 'docs',
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
