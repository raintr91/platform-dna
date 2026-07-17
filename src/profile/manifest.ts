import { readFileSync } from 'node:fs'
import path from 'node:path'
import { packageRoot, type ProfileType } from '../config/project-root.js'

export interface ProfileDefinition {
  required: string[]
  optional: string[]
  repoMarkers: string[]
  requiresAdapter?: boolean
  adapters?: string[]
  ownedSkills?: string[]
}

export interface PackageDefinition {
  repository: string
  command: string
  bin: string
  types: ProfileType[]
  invocations: Partial<Record<ProfileType, string[][]>>
}

export interface ProfilesManifest {
  schemaVersion: 1
  profiles: Record<ProfileType, ProfileDefinition>
  packages: Record<string, PackageDefinition>
}

export function loadProfiles(): ProfilesManifest {
  const manifest = JSON.parse(
    readFileSync(path.join(packageRoot(), 'profiles.json'), 'utf8'),
  ) as ProfilesManifest
  if (manifest.schemaVersion !== 1) throw new Error('Unsupported profiles.json schemaVersion')
  for (const [type, profile] of Object.entries(manifest.profiles)) {
    if (!Array.isArray(profile.required) || !Array.isArray(profile.optional)) {
      throw new Error(`Invalid profile ${type}: required/optional arrays are required`)
    }
    for (const packageId of profile.required) {
      const pkg = manifest.packages[packageId]
      if (!pkg) throw new Error(`Profile ${type} references unknown required package ${packageId}`)
      if (!pkg.types.includes(type as ProfileType)) {
        throw new Error(`Package ${packageId} does not support profile ${type}`)
      }
    }
  }
  return manifest
}
