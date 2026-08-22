/** Profile bundle list access shared by the Gala compose and market services. */

import { readProfileManifest, writeProfileManifest } from '@deepseek-ai/dsh-app-boot'

const BIN_NAME = 'dsh-plugin-desktop'

/**
 * Read `dsh.profile.bundles` from one profile manifest.
 * @param profileDir - absolute profile directory holding `package.json`.
 * @returns the declared bundle list, or an empty list when none is declared.
 */
export function readProfileBundles(profileDir: string): readonly string[] {
  const manifest = readProfileManifest(BIN_NAME, profileDir)
  const value = (manifest.dsh?.profile as { bundles?: unknown } | undefined)?.bundles
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some(bundle => typeof bundle !== 'string')) {
    throw new Error(`${BIN_NAME}: dsh.profile.bundles must be an array of package names`)
  }
  return [...value] as string[]
}

/**
 * Replace `dsh.profile.bundles` while preserving every other manifest field.
 * @param profileDir - absolute profile directory holding `package.json`.
 * @param bundles - complete replacement bundle list.
 */
export function writeProfileBundles(profileDir: string, bundles: readonly string[]): void {
  const manifest = readProfileManifest(BIN_NAME, profileDir)
  writeProfileManifest(profileDir, {
    ...manifest,
    dsh: {
      ...manifest.dsh,
      profile: {
        ...manifest.dsh?.profile,
        bundles: [...bundles],
      },
    },
  })
}
