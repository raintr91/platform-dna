import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** Product hubs only — never MCP tooling packages. */
export type ProfileType = 'docs' | 'fe' | 'be' | 'tests'

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

export function resolveType(value?: string): ProfileType {
  const type = value ?? 'docs'
  if (!['docs', 'fe', 'be', 'tests'].includes(type)) {
    throw new Error('--type must be docs | fe | be | tests (docs/code hubs only; not MCP packages)')
  }
  return type as ProfileType
}
