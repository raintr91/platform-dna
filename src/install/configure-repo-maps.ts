/**
 * Shared path + markers for `/configure-repo-maps` across toolkits.
 *
 * Platform DNA owns the SSOT skill. Bundlekit / Processkit ship thin copies for
 * install-order independence. Harness install must not leave DNA `init` aborted
 * when a thin copy is already present, and must not overwrite DNA SSOT with a
 * thin copy when DNA ran first.
 */

export const CONFIGURE_REPO_MAPS_REL = '.cursor/skills/configure-repo-maps/SKILL.md'

const DNA_SSOT_MARKER = '<!-- platform-dna:configure-repo-maps-ssot -->'
const THIN_MARKER = '<!-- toolkit:configure-repo-maps-thin -->'

export function isDnaConfigureRepoMapsSsot(content: string): boolean {
  return content.includes(DNA_SSOT_MARKER)
}

export function isVendorThinConfigureRepoMaps(content: string): boolean {
  return content.includes(THIN_MARKER)
}
