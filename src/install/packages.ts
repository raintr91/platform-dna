import { existsSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import type { PackageDefinition, ProfilesManifest } from '../profile/manifest.js'
import type { ProfileType } from '../config/project-root.js'

interface Executable {
  command: string
  prefix: string[]
}

function run(
  command: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): void {
  const result = spawnSync(command, args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    encoding: 'utf8',
    stdio: 'pipe',
  })
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed (${result.status ?? 'spawn'}): ${result.stderr || result.stdout}`,
    )
  }
}

function onPath(command: string): boolean {
  const pathValue = process.env.PATH ?? ''
  const extensions =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';')
      : ['']
  return pathValue.split(path.delimiter).some((dir) =>
    extensions.some((ext) => existsSync(path.join(dir, `${command}${ext}`))),
  )
}

function envRoot(id: string): string | undefined {
  return process.env[`PLATFORM_DNA_${id.toUpperCase().replaceAll('-', '_')}_ROOT`]
}

function executableFromRoot(root: string, pkg: PackageDefinition): Executable {
  const bin = path.join(path.resolve(root), pkg.bin)
  if (!existsSync(bin)) throw new Error(`Package binary missing: ${bin}`)
  return { command: process.execPath, prefix: [bin] }
}

function installPackage(
  id: string,
  pkg: PackageDefinition,
  home: string,
): Executable {
  const root = path.join(home, 'packages', id)
  if (!existsSync(path.join(root, '.git'))) {
    mkdirSync(path.dirname(root), { recursive: true })
    run('git', ['clone', '--depth', '1', pkg.repository, root])
  }
  if (!existsSync(path.join(root, 'package.json'))) {
    throw new Error(`Installed package ${id} has no package.json: ${root}`)
  }
  if (onPath('pnpm')) {
    run('pnpm', ['install', '--frozen-lockfile'], { cwd: root })
    run('pnpm', ['build'], { cwd: root })
  } else {
    run('npm', ['install'], { cwd: root })
    run('npm', ['run', 'build'], { cwd: root })
  }
  return executableFromRoot(root, pkg)
}

function resolveExecutable(opts: {
  id: string
  pkg: PackageDefinition
  packageRoots: Record<string, string>
  installMissing: boolean
  home: string
}): Executable {
  const explicit = opts.packageRoots[opts.id] ?? envRoot(opts.id)
  if (explicit) return executableFromRoot(explicit, opts.pkg)
  if (onPath(opts.pkg.command)) return { command: opts.pkg.command, prefix: [] }
  const installed = path.join(opts.home, 'packages', opts.id)
  if (existsSync(path.join(installed, opts.pkg.bin))) {
    return executableFromRoot(installed, opts.pkg)
  }
  if (!opts.installMissing) {
    throw new Error(
      `${opts.id} is not installed; rerun without --no-install or set PLATFORM_DNA_${opts.id.toUpperCase()}_ROOT`,
    )
  }
  return installPackage(opts.id, opts.pkg, opts.home)
}

function expand(
  values: string[],
  vars: {
    projectRoot: string
    adapter?: string
    docsRoot?: string
    force?: boolean
  },
): string[] {
  return values.flatMap((value) => {
    if (value === '{force}') return vars.force ? ['--force'] : []
    if (value === '{docsRootArg}') {
      return vars.docsRoot ? [`--docs-root=${path.resolve(vars.docsRoot)}`] : []
    }
    return [
      value
        .replaceAll('{projectRoot}', vars.projectRoot)
        .replaceAll('{adapter}', vars.adapter ?? ''),
    ]
  })
}

export function resolvePackageSet(opts: {
  manifest: ProfilesManifest
  type: ProfileType
  withOptional?: string[]
  adapter?: string
}): string[] {
  const profile = opts.manifest.profiles[opts.type]
  // WinForms Line has no Playwright/E2E consumption lane; Testkit stays optional.
  const requested =
    opts.type === 'fe' && opts.adapter === 'dotnet-line'
      ? profile.recommended.filter((id) => id !== 'testkit')
      : [...profile.recommended]
  for (const id of opts.withOptional ?? []) {
    if (!profile.optional.includes(id)) {
      throw new Error(`${id} is not an optional package for profile ${opts.type}`)
    }
    requested.push(id)
  }
  return [...new Set(requested)]
}

export function installProfilePackages(opts: {
  manifest: ProfilesManifest
  type: ProfileType
  packageIds: string[]
  projectRoot: string
  adapter?: string
  docsRoot?: string
  force?: boolean
  installMissing?: boolean
  packageRoots?: Record<string, string>
  dryRun?: boolean
}): { packageId: string; argv: string[] }[] {
  const home = path.resolve(
    process.env.PLATFORM_DNA_HOME ?? path.join(os.homedir(), '.platform-dna'),
  )
  const planned: { packageId: string; argv: string[] }[] = []
  for (const id of opts.packageIds) {
    const pkg = opts.manifest.packages[id]
    if (!pkg) {
      throw new Error(
        `Package ${id} has no install metadata; install it separately or add it to profiles.json`,
      )
    }
    if (!pkg.types.includes(opts.type)) {
      throw new Error(`Package ${id} does not support profile ${opts.type}`)
    }
    const invocations = pkg.invocations[opts.type] ?? []
    const expanded = invocations.map((argv) =>
      expand(argv, {
        projectRoot: opts.projectRoot,
        adapter: opts.adapter,
        docsRoot: opts.docsRoot,
        force: opts.force,
      }),
    )
    for (const argv of expanded) planned.push({ packageId: id, argv })
    if (opts.dryRun) continue

    const executable = resolveExecutable({
      id,
      pkg,
      packageRoots: opts.packageRoots ?? {},
      installMissing: opts.installMissing !== false,
      home,
    })
    for (const argv of expanded) {
      run(executable.command, [...executable.prefix, ...argv], {
        cwd: opts.projectRoot,
      })
    }
  }
  return planned
}
