import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** Product hubs only — never MCP tooling packages. */
export type ProfileType = 'docs' | 'fe' | 'be' | 'monolith' | 'tests'

export const FE_ADAPTERS = ['nuxt4', 'nextjs', 'dotnet-line'] as const
export const BE_ADAPTERS = ['fastapi', 'laravel', 'dotnet-integration'] as const
export type FeAdapterId = (typeof FE_ADAPTERS)[number]
export type BeAdapterId = (typeof BE_ADAPTERS)[number]

export function packageRoot(): string {
  return root
}

export function packageVersion(): string {
  return (
    JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      version?: string
    }
  ).version ?? '0.0.0'
}

export function resolveProjectRoot(explicit?: string): string {
  const target = path.resolve(explicit ?? process.env.PLATFORM_DNA_ROOT ?? process.cwd())
  if (!existsSync(target)) throw new Error(`Project root not found: ${target}`)
  return target
}

const PROFILE_TYPES: ProfileType[] = ['docs', 'fe', 'be', 'monolith', 'tests']

export function resolveType(value?: string): ProfileType {
  const type = value ?? 'docs'
  if (!PROFILE_TYPES.includes(type as ProfileType)) {
    throw new Error(
      '--type must be docs | fe | be | monolith | tests (docs/code hubs only; not MCP packages)',
    )
  }
  return type as ProfileType
}

export function resolveFeAdapter(value?: string): FeAdapterId {
  const adapter = value ?? 'nuxt4'
  if (!(FE_ADAPTERS as readonly string[]).includes(adapter)) {
    throw new Error(`--fe-adapter must be ${FE_ADAPTERS.join(' | ')}`)
  }
  return adapter as FeAdapterId
}

export function resolveBeAdapter(value?: string): BeAdapterId {
  const adapter = value ?? 'fastapi'
  if (!(BE_ADAPTERS as readonly string[]).includes(adapter)) {
    throw new Error(`--be-adapter must be ${BE_ADAPTERS.join(' | ')}`)
  }
  return adapter as BeAdapterId
}
