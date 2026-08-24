import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  createGalaLayer,
  createGalaService,
  registerPersonaSection,
  type GalaHostAdapter,
  type GalaNative,
} from '../src/index.ts'
import { OFFICIAL_GALAS, STARS_GALA } from '../src/gala-officials.ts'
import {
  createGalaPersonaService,
  createGalaPersonaStore,
  GALA_PERSONA_ORDER,
  GALA_PERSONA_SECTION,
  personaProfileFor,
  personaPromptFor,
} from '../src/gala-persona.ts'
import { PERSONA_LIMITS, validateGalaJson, type GalaCharacter } from '../src/protocols/gala-json.ts'

function fixture(): { adapter: GalaHostAdapter; native: GalaNative } {
  const root = mkdtempSync(join(tmpdir(), 'gala-persona-'))
  const native: GalaNative = {
    insertCss: async () => 'css-key',
    removeCss: async () => {},
    openPanel: vi.fn(),
    confirm: async () => true,
    chooseGgal: async () => undefined,
    resolveConflict: async () => ({ action: 'skip' }),
    notify: () => {},
    relaunch: () => {},
  }
  return {
    native,
    adapter: {
      userDataDir: root,
      profileDir: root,
      packages: [],
      bundles: { read: () => [], write: () => {} },
      native,
      configureOrigin: vi.fn(),
    },
  }
}

const CUSTOM: GalaCharacter = {
  id: 'gala:custom-fox',
  name: '小狐',
  type: 'character',
  family: 'mind',
  rarity: 'rare',
  description: '爱说冷笑话的狐狸。',
  assets: { avatar: 'a.png' },
  lines: { onEquip: '嘿嘿。' },
  author: 'me',
  version: '1.0.0',
}

describe('官方人设目录', () => {
  it('十位官方角色都有人设，全员群星没有', () => {
    for (const entry of OFFICIAL_GALAS) {
      const persona = entry.character.persona
      expect(persona, entry.character.name).toBeDefined()
      expect(persona!.archetype.length).toBeGreaterThan(0)
      expect(persona!.story.length).toBeGreaterThan(20)
      expect(persona!.voice.length).toBeGreaterThanOrEqual(3)
      expect(persona!.catchphrases.length).toBeGreaterThanOrEqual(2)
      expect(validateGalaJson(entry.character), JSON.stringify(validateGalaJson.errors)).toBe(true)
    }
    expect(STARS_GALA.character.persona).toBeUndefined()
  })

  it('人设原型彼此不同，覆盖傲娇 / 粘人 / 御姐等风格', () => {
    const archetypes = OFFICIAL_GALAS.map(entry => entry.character.persona!.archetype)
    expect(new Set(archetypes).size).toBe(archetypes.length)
    const joined = archetypes.join('')
    expect(joined).toContain('傲娇')
    expect(joined).toContain('粘人')
    expect(joined).toContain('御姐')
  })

  it('gala.json schema 拒绝超长与缺字段的人设', () => {
    const tooLong = { ...CUSTOM, persona: { archetype: 'x'.repeat(PERSONA_LIMITS.archetype + 1), story: 's', voice: ['v'], catchphrases: ['c'] } }
    expect(validateGalaJson(tooLong)).toBe(false)
    const missing = { ...CUSTOM, persona: { archetype: 'a', story: 's' } }
    expect(validateGalaJson(missing)).toBe(false)
    const ok = { ...CUSTOM, persona: { archetype: 'a', story: 's', voice: ['v'], catchphrases: ['c'] } }
    expect(validateGalaJson(ok)).toBe(true)
  })
})

describe('人设提示词', () => {
  const lingling = OFFICIAL_GALAS.find(entry => entry.character.id === 'gala:dsh-llm')!.character

  it('官方角色生成带风格与底线的段落', () => {
    const prompt = personaPromptFor(lingling, true)
    expect(prompt).toContain('「灵灵」')
    expect(prompt).toContain(lingling.persona!.archetype)
    for (const rule of lingling.persona!.voice) expect(prompt).toContain(rule)
    expect(prompt).toContain('星星掉出来一颗')
    expect(prompt).toContain('代码、命令、路径、数据与事实必须准确')
    expect(prompt).toContain('不假装是人类')
  })

  it('关闭开关、原装、全员与经典配色都不注入', () => {
    expect(personaPromptFor(lingling, false)).toBe('')
    expect(personaPromptFor(undefined, true)).toBe('')
    expect(personaPromptFor(STARS_GALA.character, true)).toBe('')
  })

  it('自定义角色没有人设时按简介生成轻量包装', () => {
    const prompt = personaPromptFor(CUSTOM, true)
    expect(prompt).toContain('「小狐」')
    expect(prompt).toContain('爱说冷笑话的狐狸')
    expect(prompt).toContain('「嘿嘿。」')
    const profile = personaProfileFor(CUSTOM)
    expect(profile).toMatchObject({ name: '小狐', authored: false, catchphrases: ['嘿嘿。'] })
    expect(personaProfileFor(STARS_GALA.character)).toBeUndefined()
  })
})

describe('个性化人物开关存储', () => {
  it('默认关闭；写入后重读保持；坏文件回到默认关闭', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gala-persona-store-'))
    const file = join(dir, 'persona.json')
    const store = createGalaPersonaStore(file)
    expect(store.isEnabled()).toBe(false)
    store.setEnabled(true)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: 1, enabled: true })
    expect(createGalaPersonaStore(file).isEnabled()).toBe(true)
    writeFileSync(file, '{not json', 'utf8')
    expect(createGalaPersonaStore(file).isEnabled()).toBe(false)
  })

  it('服务只在状态变化时触发 onChange；关闭态不注入但仍给出摘要', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gala-persona-svc-'))
    const onChange = vi.fn()
    const service = createGalaPersonaService({
      store: createGalaPersonaStore(join(dir, 'persona.json')),
      current: () => CUSTOM,
      onChange,
    })
    expect(service.prompt()).toBe('')
    expect(service.profile()?.name).toBe('小狐')
    service.setEnabled(false)
    expect(onChange).not.toHaveBeenCalled()
    service.setEnabled(true)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(service.prompt()).toContain('「小狐」')
  })
})

describe('Gala 层与 Cordis 段落', () => {
  it('pickerState 暴露人设状态；换肤即切换提示词；关闭后立即为空', async () => {
    const { adapter, native } = fixture()
    const layer = createGalaLayer({
      userDataDir: adapter.userDataDir,
      profileDir: adapter.profileDir,
      packages: adapter.packages,
      bundles: adapter.bundles,
      native,
    })
    const service = createGalaService(adapter, layer, 'http://127.0.0.1:4321')
    await service.activate()

    // 首次启动：开关默认关闭，默认全员也没有人设
    let picker = service.panel.picker()
    expect(picker.personaEnabled).toBe(false)
    expect(picker.activePersona).toBeNull()
    expect(service.personaPrompt()).toBe('')
    expect(picker.girls.find(girl => girl.characterId === 'gala:dsh-agent')?.archetype).toContain('傲娇')
    expect(picker.girls.find(girl => girl.isDefault)?.archetype).toBe('')

    // 换上角色但未开启：摘要可见（供设置卡展示），提示词不注入
    await service.rpc.applySkin('gala:skin-dsh-agent')
    picker = service.panel.picker()
    expect(picker.activePersona?.name).toBe('阿念')
    expect(service.personaPrompt()).toBe('')

    await service.rpc.setPersonaEnabled?.(true)
    expect(service.panel.picker().personaEnabled).toBe(true)
    expect(service.personaPrompt()).toContain('「阿念」')

    await service.rpc.setPersonaEnabled?.(false)
    expect(service.panel.picker().personaEnabled).toBe(false)
    expect(service.personaPrompt()).toBe('')

    await service.rpc.setPersonaEnabled?.(true)
    await service.rpc.revertSkin()
    expect(service.panel.picker().activePersona).toBeNull()
    expect(service.personaPrompt()).toBe('')
  })

  it('以 gala:persona 段落注册进 systemPrompt，文本按组装时实时解析', () => {
    const sections: Array<{ name: string; order: number; text: unknown }> = []
    let prompt = 'A'
    const service = { personaPrompt: () => prompt } as Parameters<typeof registerPersonaSection>[1]
    const ctx = {
      inject: (deps: string[], callback: (child: unknown) => void) => {
        expect(deps).toEqual(['systemPrompt'])
        callback({ systemPrompt: { section: (section: { name: string; order: number; text: unknown }) => { sections.push(section); return () => {} } } })
      },
    }
    registerPersonaSection(ctx as never, service)
    expect(sections).toHaveLength(1)
    expect(sections[0]).toMatchObject({ name: GALA_PERSONA_SECTION, order: GALA_PERSONA_ORDER })
    const text = sections[0]!.text as () => string
    expect(text()).toBe('A')
    prompt = 'B'
    expect(text()).toBe('B')
  })
})
