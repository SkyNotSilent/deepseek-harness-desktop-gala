import { describe, expect, it } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  selectDesktopProfile,
  beginDesktopProfileStartup,
  markDesktopProfileHealthy,
  markDesktopProfileFailed,
  type DesktopProfileStateV1,
} from '../src/profile-manager.ts'

/** 创建初始桌面状态文件，lastKnownGood = 'desktop' */
function initState(dir: string, active: string): string {
  const statePath = join(dir, 'dsh-desktop-state.json')
  const initial: DesktopProfileStateV1 = {
    version: 1,
    active,
    lastKnownGood: 'desktop',
  }
  writeFileSync(statePath, JSON.stringify(initial), 'utf8')
  return statePath
}

/** 创建 webCapable 的 profile 目录（dsh-base 在 dsh-web-app 之前） */
function makeProfile(dir: string, name: string): void {
  const profileDir = join(dir, 'profiles', name)
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
    name: `profile-${name}`,
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
  }), 'utf8')
  writeFileSync(join(profileDir, 'cordis.yml'), 'plugins:\n  - { id: "@deepseek-ai/dsh-base" }', 'utf8')
}

describe('G15 · 启动失败回滚 lastKnownGood', () => {
  it('markDesktopProfileFailed 回滚到 lastKnownGood', () => {
    const dir = mkdtempSync(join(tmpdir(), 'g15-'))
    const home = join(dir, 'home')
    makeProfile(home, 'new-profile')
    const statePath = initState(dir, 'desktop')

    // 模拟合成操作：选择新 profile → 视为 pending
    selectDesktopProfile(statePath, home, 'new-profile')

    // 模拟启动：pending 被消费，active 变为 new-profile
    const startup = beginDesktopProfileStartup(statePath, home)
    expect(startup.profileName).toBe('new-profile')

    // 模拟启动失败：回滚到 lastKnownGood
    const after = markDesktopProfileFailed(statePath, 'new-profile')
    expect(after.active).toBe('desktop')
    expect(after.lastKnownGood).toBe('desktop')
  })

  it('markDesktopProfileHealthy 将 active 提升为 lastKnownGood', () => {
    const dir = mkdtempSync(join(tmpdir(), 'g15-'))
    const home = join(dir, 'home')
    makeProfile(home, 'new-profile')
    const statePath = initState(dir, 'desktop')

    selectDesktopProfile(statePath, home, 'new-profile')
    beginDesktopProfileStartup(statePath, home)

    // 模拟启动成功
    const after = markDesktopProfileHealthy(statePath, 'new-profile')
    expect(after.active).toBe('new-profile')
    expect(after.lastKnownGood).toBe('new-profile')
  })

  it('先 healthy 再 failed：新 profile 已提升为 LKG，回滚到 LKG 而非原始', () => {
    const dir = mkdtempSync(join(tmpdir(), 'g15-'))
    const home = join(dir, 'home')
    makeProfile(home, 'new-profile')
    makeProfile(home, 'v2-profile')
    const statePath = initState(dir, 'desktop')

    // 第一次合成：new-profile 启动成功，成为 LKG
    selectDesktopProfile(statePath, home, 'new-profile')
    beginDesktopProfileStartup(statePath, home)
    markDesktopProfileHealthy(statePath, 'new-profile')

    // 第二次合成：v2-profile 启动失败，回滚到 LKG = new-profile
    selectDesktopProfile(statePath, home, 'v2-profile')
    beginDesktopProfileStartup(statePath, home)
    const after = markDesktopProfileFailed(statePath, 'v2-profile')
    expect(after.active).toBe('new-profile')
    expect(after.lastKnownGood).toBe('new-profile')
  })

  it('pending 指向的 profile 在启动前消失 → beginDesktopProfileStartup 自动回滚到 LKG', () => {
    const dir = mkdtempSync(join(tmpdir(), 'g15-'))
    const home = join(dir, 'home')
    makeProfile(home, 'new-profile')
    const statePath = initState(dir, 'desktop')

    // 合成：选择 new-profile（此时存在，select 成功）
    selectDesktopProfile(statePath, home, 'new-profile')

    // 启动前 profile 目录被删除（包损坏 / 用户移除）
    rmSync(join(home, 'profiles', 'new-profile'), { recursive: true, force: true })

    // 启动：pending 不可选 → 回滚到 desktop
    const startup = beginDesktopProfileStartup(statePath, home)
    expect(startup.profileName).toBe('desktop')
    expect(startup.rolledBackFrom).toBe('new-profile')
  })

  it('markDesktopProfileFailed 对不活跃的 profile 抛错', () => {
    const dir = mkdtempSync(join(tmpdir(), 'g15-'))
    const home = join(dir, 'home')
    makeProfile(home, 'other')
    const statePath = initState(dir, 'desktop')

    expect(() => markDesktopProfileFailed(statePath, 'other')).toThrow('cannot fail inactive profile')
  })
})