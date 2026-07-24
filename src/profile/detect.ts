import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { ProfileDefinition } from './manifest.js'
import type { ProfileType } from '../config/project-root.js'

export function declaredRole(root: string): string | undefined {
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

export function normalizeRole(role?: string): string | undefined {
  if (!role) return undefined
  return {
    frontend: 'fe',
    portal: 'fe',
    client: 'fe',
    backend: 'be',
    api: 'be',
    fullstack: 'monolith',
    mono: 'monolith',
    test: 'tests',
    plans: 'tests',
  }[role] ?? role
}

export function declaredProfileType(root: string): ProfileType | undefined {
  const role = normalizeRole(declaredRole(root))
  return role === 'docs' ||
    role === 'fe' ||
    role === 'be' ||
    role === 'monolith' ||
    role === 'tests'
    ? role
    : undefined
}

function hasDotnetMarker(root: string): boolean {
  try {
    return readdirSync(root).some((name) => name.endsWith('.sln') || name.endsWith('.csproj'))
  } catch {
    return false
  }
}

function markerPresent(root: string, marker: string): boolean {
  if (marker.includes('*')) {
    const suffix = marker.replace(/^\*/, '')
    try {
      return readdirSync(root).some((name) => name.endsWith(suffix))
    } catch {
      return false
    }
  }
  return existsSync(path.join(root, marker))
}

function validateFeAdapter(root: string, adapter: string, force?: boolean): void {
  if (adapter === 'dotnet-line') {
    if (!hasDotnetMarker(root) && !force) {
      throw new Error(
        'Selected dotnet-line, but no .sln/.csproj found; pass --force only for a new base',
      )
    }
    return
  }
  const expected =
    adapter === 'nuxt4'
      ? ['nuxt.config.ts', 'nuxt.config.js']
      : ['next.config.ts', 'next.config.js', 'next.config.mjs']
  if (!expected.some((file) => existsSync(path.join(root, file))) && !force) {
    throw new Error(
      `Selected ${adapter}, but no ${expected.join(' or ')} found; pass --force only for a new base`,
    )
  }
}

function validateBeAdapter(root: string, adapter: string, force?: boolean): void {
  if (adapter === 'dotnet-integration') {
    if (!hasDotnetMarker(root) && !force) {
      throw new Error(
        'Selected dotnet-integration, but no .sln/.csproj found; pass --force only for a new base',
      )
    }
    return
  }
  if (adapter === 'fastapi') {
    const pyproject = path.join(root, 'pyproject.toml')
    if (!existsSync(pyproject) && !force) {
      throw new Error('Selected fastapi, but pyproject.toml is missing')
    }
    if (
      existsSync(pyproject) &&
      !/\bfastapi\b/i.test(readFileSync(pyproject, 'utf8')) &&
      !force
    ) {
      throw new Error('Selected fastapi, but pyproject.toml does not declare FastAPI')
    }
    return
  }
  if (adapter === 'laravel') {
    const roots = [root, path.join(root, 'src')]
    const laravelRoot = roots.find(
      (candidate) =>
        existsSync(path.join(candidate, 'artisan')) &&
        existsSync(path.join(candidate, 'composer.json')),
    )
    if (!laravelRoot && !force) {
      throw new Error('Selected laravel, but artisan + composer.json are missing at root or src/')
    }
    if (laravelRoot && !force) {
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

export function validateTarget(opts: {
  root: string
  type: ProfileType
  profile: ProfileDefinition
  adapter?: string
  feAdapter?: string
  beAdapter?: string
  force?: boolean
}): void {
  if (existsSync(path.join(opts.root, 'mcp-package.json')) && !opts.force) {
    throw new Error(
      'Target looks like an MCP package (mcp-package.json present); Platform DNA installs only into docs/fe/be/monolith/tests hubs — not into MCP tooling repos',
    )
  }
  const role = normalizeRole(declaredRole(opts.root))
  if (role === 'tooling' && !opts.force) {
    throw new Error(
      'Repository declares role=tooling; Platform DNA does not install into MCP tooling repos',
    )
  }
  if (role && role !== opts.type && !opts.force) {
    throw new Error(
      `Repository declares role=${role}, not ${opts.type}; use the correct --type or explicit --force`,
    )
  }

  if (opts.type === 'monolith') {
    const feAdapter = opts.feAdapter
    const beAdapter = opts.beAdapter
    if (!feAdapter) throw new Error('--fe-adapter is required for --type=monolith')
    if (!beAdapter) throw new Error('--be-adapter is required for --type=monolith')
    if (!opts.profile.feAdapters?.includes(feAdapter)) {
      throw new Error(
        `--fe-adapter for monolith must be ${opts.profile.feAdapters?.join(' | ')}`,
      )
    }
    if (!opts.profile.beAdapters?.includes(beAdapter)) {
      throw new Error(
        `--be-adapter for monolith must be ${opts.profile.beAdapters?.join(' | ')}`,
      )
    }
    validateFeAdapter(opts.root, feAdapter, opts.force)
    validateBeAdapter(opts.root, beAdapter, opts.force)
  } else if (opts.profile.requiresAdapter) {
    if (!opts.adapter) throw new Error(`--adapter is required for --type=${opts.type}`)
    if (!opts.profile.adapters?.includes(opts.adapter)) {
      throw new Error(
        `--adapter for ${opts.type} must be ${opts.profile.adapters?.join(' | ')}`,
      )
    }
    if (opts.type === 'fe') validateFeAdapter(opts.root, opts.adapter, opts.force)
    if (opts.type === 'be') validateBeAdapter(opts.root, opts.adapter, opts.force)
  }

  const markerFound =
    opts.profile.repoMarkers.length === 0 ||
    opts.profile.repoMarkers.some((marker) => markerPresent(opts.root, marker))
  if (!markerFound && !role && !opts.force) {
    throw new Error(
      `Repository does not look like a ${opts.type} base (expected one of: ${opts.profile.repoMarkers.join(', ')}); use --force only for a new empty base`,
    )
  }
}
