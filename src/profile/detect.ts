import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { ProfileDefinition } from './manifest.js'
import type { ProfileType } from '../config/project-root.js'

function declaredRole(root: string): string | undefined {
  const file = path.join(root, 'platform-repos.json')
  if (!existsSync(file)) return undefined
  try {
    const data = JSON.parse(readFileSync(file, 'utf8')) as {
      projects?: Record<string, { root?: string; role?: string }>
    }
    return Object.values(data.projects ?? {}).find((project) => project.root === '.')?.role
  } catch {
    return undefined
  }
}

function normalizeRole(role?: string): string | undefined {
  if (!role) return undefined
  return {
    frontend: 'fe',
    portal: 'fe',
    backend: 'be',
    api: 'be',
    test: 'tests',
    plans: 'tests',
  }[role] ?? role
}

export function validateTarget(opts: {
  root: string
  type: ProfileType
  profile: ProfileDefinition
  adapter?: string
  force?: boolean
}): void {
  if (opts.type === 'tooling') return
  const role = normalizeRole(declaredRole(opts.root))
  if (role && role !== opts.type && !opts.force) {
    throw new Error(
      `Repository declares role=${role}, not ${opts.type}; use the correct --type or explicit --force`,
    )
  }
  if (opts.profile.requiresAdapter) {
    if (!opts.adapter) throw new Error(`--adapter is required for --type=${opts.type}`)
    if (!opts.profile.adapters?.includes(opts.adapter)) {
      throw new Error(
        `--adapter for ${opts.type} must be ${opts.profile.adapters?.join(' | ')}`,
      )
    }
  }
  const markerFound = opts.profile.repoMarkers.some((marker) =>
    existsSync(path.join(opts.root, marker)),
  )
  if (!markerFound && !role && !opts.force) {
    throw new Error(
      `Repository does not look like a ${opts.type} base (expected one of: ${opts.profile.repoMarkers.join(', ')}); use --force only for a new empty base`,
    )
  }
  if (opts.type === 'fe' && opts.adapter) {
    const expected =
      opts.adapter === 'nuxt4'
        ? ['nuxt.config.ts', 'nuxt.config.js']
        : ['next.config.ts', 'next.config.js', 'next.config.mjs']
    if (!expected.some((file) => existsSync(path.join(opts.root, file))) && !opts.force) {
      throw new Error(
        `Selected ${opts.adapter}, but no ${expected.join(' or ')} found; pass --force only for a new base`,
      )
    }
  }
  if (opts.type === 'be' && opts.adapter === 'fastapi') {
    const pyproject = path.join(opts.root, 'pyproject.toml')
    if (!existsSync(pyproject) && !opts.force) {
      throw new Error('Selected fastapi, but pyproject.toml is missing')
    }
    if (
      existsSync(pyproject) &&
      !/\bfastapi\b/i.test(readFileSync(pyproject, 'utf8')) &&
      !opts.force
    ) {
      throw new Error('Selected fastapi, but pyproject.toml does not declare FastAPI')
    }
  }
  if (opts.type === 'be' && opts.adapter === 'laravel') {
    const roots = [opts.root, path.join(opts.root, 'src')]
    const laravelRoot = roots.find(
      (candidate) =>
        existsSync(path.join(candidate, 'artisan')) &&
        existsSync(path.join(candidate, 'composer.json')),
    )
    if (!laravelRoot && !opts.force) {
      throw new Error('Selected laravel, but artisan + composer.json are missing at root or src/')
    }
    if (laravelRoot && !opts.force) {
      const composer = JSON.parse(
        readFileSync(path.join(laravelRoot, 'composer.json'), 'utf8'),
      )
      const dependencies = {
        ...(composer.require ?? {}),
        ...(composer['require-dev'] ?? {}),
      }
      if (!dependencies['laravel/framework']) {
        throw new Error('Selected laravel, but composer.json does not require laravel/framework')
      }
      if (!dependencies['nwidart/laravel-modules']) {
        throw new Error(
          'Codegenkit laravel adapter requires nwidart/laravel-modules (modules-v1)',
        )
      }
    }
  }
}
