import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { composeEntries } from '@deepseek-ai/dsh-app-boot'
import { parse } from 'yaml'
import { prepareDesktopProfile, shippedPresetRoot } from '../src/profile.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

const homes: string[] = []

function temporaryHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'dsh-alpha2-defaults-'))
  homes.push(home)
  return home
}

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

function presetToolWeb(preset: string): Record<string, unknown> | undefined {
  const rows = parse(readFileSync(join(shippedPresetRoot(), preset, 'agent.cordis.yml'), 'utf8')) as Array<Record<string, unknown>>
  return rows.find(row => row.id === 'tool-web')
}

describe('alpha.2 product defaults', () => {
  it.each([undefined, '', '0', 'false', '1'])('force-disables session telemetry for DSH_TELEMETRY_DISABLED=%s', (value) => {
    const prepared = prepareDesktopProfile(value, temporaryHome(), 'darwin')
    const telemetry = composeEntries([prepared.patches]).find(row => row.id === 'session-telemetry-otel')

    expect(telemetry).toEqual(expect.objectContaining({
      name: '@deepseek-ai/dsh-session-telemetry-otel',
      disabled: true,
    }))
  })

  it.each(['darwin', 'linux', 'win32'] as const)(
    'force-disables session-log upload after a %s machine patch tries to opt in',
    (platform) => {
      const home = temporaryHome()
      writeFileSync(join(home, 'cordis.patch.yml'), [
        '- id: session-log-deepseek',
        '  disabled: false',
        '  config:',
        '    enabled: true',
        '',
      ].join('\n'))

      const rows = composeEntries([prepareDesktopProfile(undefined, home, platform).patches])
      expect(rows.find(row => row.id === 'session-log-deepseek')).toEqual(expect.objectContaining({
        name: '@deepseek-ai/dsh-session-log-deepseek',
        disabled: true,
        config: expect.objectContaining({ enabled: true }),
      }))
    },
  )

  it('keeps plugin package inventory enabled while the global Web tool stays disabled', () => {
    const rows = composeEntries([prepareDesktopProfile(undefined, temporaryHome(), 'darwin').patches])

    expect(rows.find(row => row.id === 'plugin-package-inventory-deepseek')).toEqual(expect.objectContaining({
      name: '@deepseek-ai/dsh-plugin-package-inventory-deepseek',
    }))
    expect(rows.find(row => row.id === 'plugin-package-inventory-deepseek')?.disabled).toBeFalsy()
    expect(rows.find(row => row.id === 'tool-web')).toEqual(expect.objectContaining({
      disabled: true,
      config: expect.objectContaining({ fetch: false }),
    }))
  })

  it('uses the alpha.2 preset package and follows its layered WebFetch policy', () => {
    const root = shippedPresetRoot()
    expect(existsSync(root)).toBe(true)
    for (const preset of ['standard', 'ptc', 'cordis']) {
      expect(presetToolWeb(preset)).toEqual(expect.objectContaining({
        name: '@deepseek-ai/dsh-tool-web',
        config: expect.objectContaining({ fetch: true }),
      }))
    }
    expect(presetToolWeb('minimal')).toBeUndefined()

    const rows = composeEntries([prepareDesktopProfile(undefined, temporaryHome(), 'darwin').patches])
    expect(rows.find(row => row.id === 'agent-presets')?.config).toEqual(expect.objectContaining({
      roots: [{ path: root, trust: 'system' }],
    }))
  })
})
