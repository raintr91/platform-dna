import { resolveType, type ProfileType } from '../config/project-root.js'
import { declaredProfileType } from '../profile/detect.js'
import type { ProfilesManifest } from '../profile/manifest.js'
import {
  agentIds,
  agentNames,
  detectAgents,
  parseAgentTargets,
  type AgentId,
} from './agents.js'
import {
  checkboxPrompt,
  selectPrompt,
  type CheckboxChoice,
} from './prompt.js'

const laneChoices: Array<{ value: ProfileType; name: string }> = [
  { value: 'docs', name: 'Docs' },
  { value: 'fe', name: 'Frontend (FE)' },
  { value: 'be', name: 'Backend (BE)' },
  { value: 'tests', name: 'Tests' },
]

const adapterNames: Record<string, string> = {
  nuxt4: 'Nuxt 4',
  nextjs: 'Next.js',
  'dotnet-line': '.NET Line',
  fastapi: 'FastAPI',
  laravel: 'Laravel',
  'dotnet-integration': '.NET Integration',
}

export interface InitWizardPrompts {
  checkbox<T extends string>(opts: {
    message: string
    choices: CheckboxChoice<T>[]
  }): Promise<T[]>
  select<T extends string>(opts: {
    message: string
    choices: Array<{ value: T; name: string }>
    defaultIndex?: number
  }): Promise<T>
}

export interface InitWizardSelection {
  targets: AgentId[]
  target: string
  type: ProfileType
  adapter?: string

  /** Whether to wire cross-repo CodeGraph MCP servers during this init. */
  wireCodegraph: boolean
}

export async function resolveInitWizard(opts: {
  root: string
  manifest: ProfilesManifest
  requestedTarget?: string
  requestedType?: string
  requestedAdapter?: string

  /** Explicit `--codegraph` / `--no-codegraph`; undefined defers to the wizard. */
  wireCodegraphFlag?: boolean
  /** CodeGraph server keys available to wire (derived from machine-local maps). */
  codegraphCandidateKeys?: string[]
  interactive: boolean
  detectedAgents?: AgentId[]
  prompts?: InitWizardPrompts
}): Promise<InitWizardSelection> {
  const prompts = opts.prompts ?? {
    checkbox: checkboxPrompt,
    select: selectPrompt,
  }
  const detected = opts.detectedAgents ?? detectAgents(opts.root)

  const targets =
    opts.interactive && !opts.requestedTarget
      ? await prompts.checkbox({
          message: 'Which agents should receive toolkit setup?',
          choices: agentIds.map((id) => ({
            value: id,
            name: detected.includes(id) ? `${agentNames[id]} (detected)` : agentNames[id],
            checked: detected.length ? detected.includes(id) : id === 'cursor',
          })),
        })
      : parseAgentTargets(opts.requestedTarget, detected)

  const lockedType = declaredProfileType(opts.root)
  const type = opts.requestedType
    ? resolveType(opts.requestedType)
    : lockedType
      ? lockedType
      : opts.interactive
        ? await prompts.select({
            message: 'Select the destination lane:',
            choices: laneChoices,
          })
        : resolveType()

  const profile = opts.manifest.profiles[type]
  let adapter = opts.requestedAdapter
  if (opts.interactive && profile.requiresAdapter && !adapter) {
    adapter = await prompts.select({
      message: `Select the ${type.toUpperCase()} adapter:`,
      choices: (profile.adapters ?? []).map((value) => ({
        value,
        name: adapterNames[value] ?? value,
      })),
    })
  }



  // Cross-repo CodeGraph wiring: only meaningful when Cursor is targeted and the
  // machine-local maps declare other repos. Members can skip and wire later.
  const cursorSelected = targets.includes('cursor')
  const candidates = opts.codegraphCandidateKeys ?? []
  let wireCodegraph = opts.wireCodegraphFlag ?? cursorSelected
  if (
    opts.wireCodegraphFlag === undefined &&
    opts.interactive &&
    cursorSelected &&
    candidates.length
  ) {
    const choice = await prompts.select({
      message: `Wire cross-repo CodeGraph servers for ${candidates.length} repo(s) now?`,
      choices: [
        { value: 'yes', name: 'Yes — wire into .cursor/mcp.json now' },
        { value: 'later', name: 'Skip — run `platform-dna codegraph:wire` later' },
      ],
    })
    wireCodegraph = choice === 'yes'
  }

  return {
    targets,
    target: targets.join(',') || 'none',
    type,
    adapter,

    wireCodegraph: wireCodegraph && cursorSelected,
  }
}
