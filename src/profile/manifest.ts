import { readFileSync } from 'node:fs'
import path from 'node:path'
import { packageRoot, type ProfileType } from '../config/project-root.js'

export interface ProfileDefinition {
  repoMarkers: string[]
  requiresAdapter?: boolean
  adapters?: string[]
  ownedSkills?: string[]
}

export interface ProfilesManifest {
  schemaVersion: 1
  profiles: Record<ProfileType, ProfileDefinition>
}

export function loadProfiles(): ProfilesManifest {
  const manifest = JSON.parse(
    readFileSync(path.join(packageRoot(), 'profiles.json'), 'utf8'),
  ) as ProfilesManifest
  if (manifest.schemaVersion !== 1) throw new Error('Unsupported profiles.json schemaVersion')
  return manifest
}
