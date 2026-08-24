import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGalaWorkspaceCoordinator, readGalaWorkspaceMarker } from '../src/gala-workspaces.ts'

const roots: string[] = []

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'gala-workspaces-'))
  roots.push(root)
  const userDataDir = join(root, 'user-data')
  const homeDir = join(root, 'dsh-home')
  const currentProfileName = 'desktop'
  const currentProfileDir = join(homeDir, 'profiles', currentProfileName)
  mkdirSync(currentProfileDir, { recursive: true })
  writeFileSync(join(currentProfileDir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-desktop',
    private: true,
    dependencies: {
      '@deepseek-ai/dsh-base': '0.1.1-rc.2',
      '@deepseek-ai/dsh-web-app': '0.1.1-rc.2',
      'third-party-bundle': '1.2.3',
    },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'third-party-bundle'] } },
  }, null, 2) + '\n')
  writeFileSync(join(homeDir, 'settings.yaml'), 'agent:\n  model: deepseek-chat\n  apiKey: must-not-copy\n')
  const selected: string[] = []
  let restarts = 0
  const validateProfile = vi.fn<(name: string) => void>()
  const coordinator = createGalaWorkspaceCoordinator({
    userDataDir,
    homeDir,
    currentProfileName,
    currentProfileDir,
    validateProfile,
    selectProfile: async name => { selected.push(name) },
    restartCurrentProfile: async () => { restarts += 1 },
  })
  return {
    root, userDataDir, homeDir, currentProfileDir, coordinator, selected, validateProfile,
    restarts: () => restarts,
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Gala role workspaces', () => {
  it('defaults to shared mode and creates no internal profile', () => {
    const { coordinator, homeDir } = fixture()
    expect(coordinator.summary()).toMatchObject({ mode: 'shared', activeWorkspace: null, restartRequired: false })
    expect(readdirSync(join(homeDir, 'profiles'))).toEqual(['desktop'])
  })

  it('freezes one seed on enable but lazily creates profiles', async () => {
    const { coordinator, userDataDir, homeDir } = fixture()
    await coordinator.enable()
    expect(coordinator.summary().mode).toBe('isolated')
    expect(existsSync(join(userDataDir, 'gala', 'workspace-seed', 'package.json'))).toBe(true)
    expect(readdirSync(join(homeDir, 'profiles'))).toEqual(['desktop'])
  })

  it('materializes an official role, writes its appearance, validates, then selects', async () => {
    const { coordinator, homeDir, selected, validateProfile } = fixture()
    await coordinator.enable()
    const result = await coordinator.switchWorkspace({ personaId: 'gala:dsh-llm', name: '灵灵' }, 'gala:skin-dsh-llm')

    expect(result).toEqual({ restarted: true, profileName: 'gala-dsh-llm' })
    expect(validateProfile).toHaveBeenCalledWith('gala-dsh-llm')
    expect(selected).toEqual(['gala-dsh-llm'])
    const profileDir = join(homeDir, 'profiles', 'gala-dsh-llm')
    expect(readGalaWorkspaceMarker(profileDir)).toEqual({ version: 1, personaId: 'gala:dsh-llm', personaName: '灵灵' })
    expect(readFileSync(join(profileDir, 'settings.yaml'), 'utf8')).toContain('deepseek-chat')
    expect(readFileSync(join(profileDir, 'settings.yaml'), 'utf8')).not.toContain('must-not-copy')
    expect(JSON.parse(readFileSync(coordinator.appearanceStorePath.replace('skins.json', 'appearances/gala-dsh-llm.json'), 'utf8'))).toMatchObject({
      version: 2,
      active: 'gala:skin-dsh-llm',
    })
  })

  it('hashes custom IDs instead of placing imported names or paths in Profile names', async () => {
    const { coordinator, selected } = fixture()
    await coordinator.enable()
    await coordinator.switchWorkspace({ personaId: 'gala:../../危险/角色', name: '../不可信名字' }, 'gala:skin-custom')
    expect(selected[0]).toMatch(/^gala-user-[0-9a-f]{16}$/u)
    expect(selected[0]).not.toContain('危险')
    expect(selected[0]).not.toContain('..')
  })

  it('does not select or leave the current workspace when validation fails', async () => {
    const { coordinator, selected, validateProfile } = fixture()
    validateProfile.mockImplementation(() => { throw new Error('dependency closure missing') })
    await coordinator.enable()
    await expect(coordinator.switchWorkspace({ personaId: 'gala:dsh-agent', name: '阿念' }, 'gala:skin-dsh-agent'))
      .rejects.toThrow('dependency closure missing')
    expect(selected).toEqual([])
  })

  it('keeps plugin state inside the active role and locks the core chain', async () => {
    const first = fixture()
    await first.coordinator.enable()
    await first.coordinator.switchWorkspace({ personaId: 'gala:dsh-llm', name: '灵灵' }, 'gala:skin-dsh-llm')
    const profileDir = join(first.homeDir, 'profiles', 'gala-dsh-llm')
    const active = createGalaWorkspaceCoordinator({
      userDataDir: first.userDataDir,
      homeDir: first.homeDir,
      currentProfileName: 'gala-dsh-llm',
      currentProfileDir: profileDir,
      validateProfile: () => {},
      selectProfile: async () => {},
      restartCurrentProfile: async () => {},
    })

    await active.stagePlugins({ 'third-party-bundle': false })
    expect(active.summary().restartRequired).toBe(true)
    const bundles = (JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')) as { dsh: { profile: { bundles: string[] } } }).dsh.profile.bundles
    expect(bundles).not.toContain('third-party-bundle')
    await expect(active.stagePlugins({ '@deepseek-ai/dsh-base': false })).rejects.toThrow('不可关闭')
  })

  it('preserves appearance while leaving isolation and keeps role data on disk', async () => {
    const first = fixture()
    await first.coordinator.enable()
    await first.coordinator.switchWorkspace({ personaId: 'gala:dsh-llm', name: '灵灵' }, 'gala:skin-dsh-llm')
    const profileDir = join(first.homeDir, 'profiles', 'gala-dsh-llm')
    const selected: string[] = []
    const active = createGalaWorkspaceCoordinator({
      userDataDir: first.userDataDir,
      homeDir: first.homeDir,
      currentProfileName: 'gala-dsh-llm',
      currentProfileDir: profileDir,
      validateProfile: () => {},
      selectProfile: async name => { selected.push(name) },
      restartCurrentProfile: async () => {},
    })
    await active.disable('gala:skin-dsh-llm')
    expect(selected).toEqual(['desktop'])
    expect(JSON.parse(readFileSync(join(first.userDataDir, 'gala', 'skins.json'), 'utf8'))).toMatchObject({ active: 'gala:skin-dsh-llm' })
    expect(existsSync(profileDir)).toBe(true)
  })
})
