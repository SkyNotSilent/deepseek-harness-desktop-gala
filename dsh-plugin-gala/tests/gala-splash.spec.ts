import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { skinIdForCharacter } from '../src/gala-character-skins.ts'
import { resolveGalaSplashAppearance } from '../src/gala-splash.ts'

const OFFICIALS_DIR = fileURLToPath(new URL('../assets/gala/officials', import.meta.url))
const temporaryDirectories: string[] = []

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gala-splash-'))
  temporaryDirectories.push(dir)
  return dir
}

function writeJson(filename: string, value: unknown): void {
  mkdirSync(dirname(filename), { recursive: true })
  writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function resolve(userDataDir: string, profileName = 'desktop', isolatedWorkspace = false) {
  return resolveGalaSplashAppearance({
    userDataDir,
    profileName,
    isolatedWorkspace,
    officialsDir: OFFICIALS_DIR,
  })
}

afterEach(() => {
  for (const dir of temporaryDirectories.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('Gala 启动外观解析', () => {
  it('干净安装首次进入显示 GALA·群星', () => {
    const appearance = resolve(fixture())
    expect(appearance.kind).toBe('character')
    expect(appearance.name).toBe('GALA·群星')
    expect(appearance.firstRun).toBe(true)
    expect(appearance.artPath).toContain('/stars/assets/portrait-v2.webp')
  })

  it('普通模式恢复上次选择的单角色', () => {
    const userDataDir = fixture()
    writeJson(join(userDataDir, 'gala', 'skins.json'), {
      version: 2,
      initialized: true,
      active: skinIdForCharacter('gala:dsh-agent'),
    })
    const appearance = resolve(userDataDir)
    expect(appearance.name).toBe('阿念')
    expect(appearance.firstRun).toBe(false)
    expect(appearance.artPath).toContain('/dsh-agent/assets/portrait-v2.webp')
  })

  it('明确恢复原装后，重启仍显示原装状态', () => {
    const userDataDir = fixture()
    writeJson(join(userDataDir, 'gala', 'skins.json'), {
      version: 2,
      initialized: true,
      active: null,
    })
    const appearance = resolve(userDataDir)
    expect(appearance.kind).toBe('original')
    expect(appearance.name).toBe('原装界面')
    expect(appearance.firstRun).toBe(false)
    expect(appearance.recovered).toBe(false)
  })

  it('经典配色恢复配色名与自己的主题色', () => {
    const userDataDir = fixture()
    writeJson(join(userDataDir, 'gala', 'skins.json'), {
      version: 1,
      active: 'gala:skin-mint-soda',
    })
    const appearance = resolve(userDataDir)
    expect(appearance.kind).toBe('classic')
    expect(appearance.name).toBe('薄荷苏打')
    expect(appearance.accent).toBe('#12a184')
  })

  it('角色独立空间只读取自己的外观，不串用公共空间', () => {
    const userDataDir = fixture()
    writeJson(join(userDataDir, 'gala', 'skins.json'), {
      version: 2,
      initialized: true,
      active: skinIdForCharacter('gala:dsh-agent'),
    })
    writeJson(join(userDataDir, 'gala', 'appearances', 'gala-dsh-llm.json'), {
      version: 2,
      initialized: true,
      active: skinIdForCharacter('gala:dsh-llm'),
    })
    expect(resolve(userDataDir, 'gala-dsh-llm', true).name).toBe('灵灵')
  })

  it('自定义角色恢复自己的头像与稳定主题', () => {
    const userDataDir = fixture()
    const character = {
      id: 'gala:user-one',
      name: '星芽',
      type: 'character',
      family: 'mind',
      rarity: 'rare',
      description: '用户自己的角色。',
      assets: { avatar: 'assets/avatar.png' },
      author: 'user',
      version: '1.0.0',
    }
    const packageDir = join(userDataDir, 'gala', 'market', 'user-one')
    writeJson(join(packageDir, 'gala.json'), character)
    mkdirSync(join(packageDir, 'assets'), { recursive: true })
    writeFileSync(join(packageDir, 'assets', 'avatar.png'), 'avatar')
    writeJson(join(userDataDir, 'gala', 'skins.json'), {
      version: 2,
      initialized: true,
      active: skinIdForCharacter(character.id),
    })

    const appearance = resolve(userDataDir)
    expect(appearance.name).toBe('星芽')
    expect(appearance.artPath).toBe(join(packageDir, 'assets', 'avatar.png'))
  })

  it('损坏或未知的外观记录使用原装图标安全启动', () => {
    const userDataDir = fixture()
    writeJson(join(userDataDir, 'gala', 'skins.json'), { version: 99, active: '<bad>' })
    const appearance = resolve(userDataDir)
    expect(appearance.kind).toBe('original')
    expect(appearance.recovered).toBe(true)
    expect(appearance.message).toContain('安全启动')
  })
})
