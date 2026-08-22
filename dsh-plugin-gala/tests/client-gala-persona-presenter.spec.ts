import { describe, expect, it, vi } from 'vitest'
import {
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

describe('startGalaPersonaPresenter', () => {
  it('启动同步、皮肤事件刷新、停止时还原', async () => {
    const payloads: unknown[] = [
      { picker: { persona: LINGLING } },
      { picker: { persona: null } },
    ]
    const applied: (GalaPersonaInfo | null)[] = []
    let disposed = 0
    let closed = 0
    let listener: ((event: { data: unknown }) => void) | undefined
    const presenter: GalaPersonaPresenter = {
      apply: persona => { applied.push(persona) },
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
    listener?.({ data: 'skin-changed' })
    await vi.waitFor(() => { expect(applied).toHaveLength(2) })
    expect(applied[1]).toBeNull()

    stop()
    expect(disposed).toBe(1)
    expect(closed).toBe(1)
  })
})
