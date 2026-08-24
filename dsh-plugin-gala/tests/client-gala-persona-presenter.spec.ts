import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_COMPOSER_PLACEHOLDERS,
  isDefaultComposerPlaceholder,
  parsePickerComposerPlaceholder,
  parsePickerPersona,
  PREVIEW_LABEL_FINGERPRINTS,
  startGalaPersonaPresenter,
  WELCOME_HEADLINE_FINGERPRINTS,
  type GalaPersonaInfo,
  type GalaPersonaPresenter,
} from '../src/client/gala-persona-presenter.ts'

const LINGLING: GalaPersonaInfo = {
  characterId: 'gala:dsh-llm',
  name: '灵灵',
  headline: '与星海对话',
  tagline: '语言会落成星光，照亮还没有名字的答案。',
  backdrop: '/_dsh/desktop/gala/asset?pkg=gala%3Adsh-llm&path=assets%2Fhero-v2.webp',
}

describe('picker persona 解析', () => {
  it('欢迎页文案指纹同时覆盖中英文上游界面', () => {
    expect(WELCOME_HEADLINE_FINGERPRINTS).toEqual(['探索未至之境', 'Into the Unknown'])
    expect(PREVIEW_LABEL_FINGERPRINTS).toEqual(['预览版', 'Preview'])
  })

  it('完整保留角色欢迎语与同源背景', () => {
    expect(parsePickerPersona({ picker: { persona: LINGLING } })).toEqual(LINGLING)
  })

  it('经典配色、坏结构与外链背景都降级为 null', () => {
    expect(parsePickerPersona({ picker: { persona: null } })).toBeNull()
    expect(parsePickerPersona({ picker: { persona: { ...LINGLING, headline: 42 } } })).toBeNull()
    expect(parsePickerPersona({ picker: { persona: { ...LINGLING, backdrop: 'https://evil.example/x.png' } } })).toBeNull()
    expect(parsePickerPersona(undefined)).toBeNull()
  })
})

describe('输入框邀请语', () => {
  it('只在个性化人物已开启且存在当前角色时显示角色邀请语', () => {
    expect(parsePickerComposerPlaceholder({
      picker: { personaEnabled: true, activePersona: { name: ' 灵灵 ' } },
    })).toBe('想和灵灵说点什么？')
    expect(parsePickerComposerPlaceholder({
      picker: { personaEnabled: false, activePersona: { name: '灵灵' } },
    })).toBe('')
    expect(parsePickerComposerPlaceholder({ picker: { personaEnabled: true, activePersona: null } })).toBe('')
    expect(parsePickerComposerPlaceholder(undefined)).toBe('')
  })

  it('只识别中英文上游默认文案，不覆盖特殊状态提示', () => {
    expect(DEFAULT_COMPOSER_PLACEHOLDERS).toEqual([
      '给智能体发消息',
      'Message the agent',
      '描述你想要构建的内容',
      'Describe what you want to build',
    ])
    expect(isDefaultComposerPlaceholder('给智能体发消息')).toBe(true)
    expect(isDefaultComposerPlaceholder('Message the agent')).toBe(true)
    expect(isDefaultComposerPlaceholder('描述你想要构建的内容')).toBe(true)
    expect(isDefaultComposerPlaceholder('Describe what you want to build')).toBe(true)
    expect(isDefaultComposerPlaceholder('当前会话不可用')).toBe(false)
    expect(isDefaultComposerPlaceholder('选择一个工作区开始')).toBe(false)
    expect(isDefaultComposerPlaceholder('发送消息以调整排队中的轮次')).toBe(false)
  })
})

describe('startGalaPersonaPresenter', () => {
  it('启动同步、皮肤事件刷新、停止时还原', async () => {
    const payloads: unknown[] = [
      { picker: { persona: LINGLING, personaEnabled: true, activePersona: { name: '灵灵' } } },
      { picker: { persona: null, personaEnabled: false, activePersona: null } },
    ]
    const applied: (GalaPersonaInfo | null)[] = []
    const placeholders: string[] = []
    let disposed = 0
    let closed = 0
    let listener: ((event: { data: unknown }) => void) | undefined
    const presenter: GalaPersonaPresenter = {
      apply: persona => { applied.push(persona) },
      setComposerPlaceholder: value => { placeholders.push(value) },
      dispose: () => { disposed += 1 },
    }
    const stop = startGalaPersonaPresenter({
      presenter,
      fetchImpl: vi.fn(async () => new Response(JSON.stringify(payloads.shift()), { status: 200 })) as unknown as typeof fetch,
      eventSource: () => ({
        close: () => { closed += 1 },
        addEventListener: (_type, callback) => { listener = callback },
      }),
    })

    await vi.waitFor(() => { expect(applied).toHaveLength(1) })
    expect(applied[0]).toEqual(LINGLING)
    expect(placeholders).toEqual(['想和灵灵说点什么？'])
    listener?.({ data: 'skin-changed' })
    await vi.waitFor(() => { expect(applied).toHaveLength(2) })
    expect(applied[1]).toBeNull()
    expect(placeholders).toEqual(['想和灵灵说点什么？', ''])

    stop()
    expect(disposed).toBe(1)
    expect(closed).toBe(1)
  })
})
