import { describe, expect, it } from 'vitest'
import {
  backdropBackgroundImage,
  ensurePersonaStyles,
  PERSONA_READABILITY_CSS,
  PERSONA_STAGE_CLASS,
} from '../src/client/gala-persona-presenter.ts'

describe('立绘蒙版', () => {
  it('色标全部基于 bg-base token，右端保留 38% 可读性下限', () => {
    const value = backdropBackgroundImage('/x.webp')
    expect(value).toContain('color-mix(in srgb, var(--dsw-alias-bg-base) 94%, transparent) 0%')
    expect(value).toContain('color-mix(in srgb, var(--dsw-alias-bg-base) 38%, transparent) 100%')
    expect(value).toContain('url("/x.webp")')
    expect(value).not.toMatch(/rgba\(/u)
  })

  it('url 中的引号被转义，防止拼进 CSS 破坏声明', () => {
    expect(backdropBackgroundImage('/a"b.webp')).toContain('url("/a%22b.webp")')
  })
})

describe('消息可读性样式', () => {
  it('只作用于 stage class 下的非 user 消息，选择器不含上游哈希类名', () => {
    expect(PERSONA_READABILITY_CSS).toContain(`.${PERSONA_STAGE_CLASS} [data-chat-flow-kind="assistant-step"]`)
    expect(PERSONA_READABILITY_CSS).toContain('[data-chat-flow-kind="tool-call"]')
    expect(PERSONA_READABILITY_CSS).toContain('[data-chat-flow-kind="context"]')
    expect(PERSONA_READABILITY_CSS).not.toContain('"user"')
    expect(PERSONA_READABILITY_CSS).not.toMatch(/\.[A-Za-z0-9-]{6}_/u)
  })

  it('卡底为半透明 bg-base 加毛玻璃，负 margin 与 padding 对齐正文列', () => {
    expect(PERSONA_READABILITY_CSS).toContain('color-mix(in srgb, var(--dsw-alias-bg-base) 78%, transparent)')
    expect(PERSONA_READABILITY_CSS).toContain('backdrop-filter: blur(10px)')
    expect(PERSONA_READABILITY_CSS).toContain('-webkit-backdrop-filter: blur(10px)')
    expect(PERSONA_READABILITY_CSS).toContain('padding: 8px 14px')
    expect(PERSONA_READABILITY_CSS).toContain('margin-inline: -14px')
  })

  it('ensurePersonaStyles 幂等注入并带 data-plugin-css 标记', () => {
    const appended: Array<{ dataset: Record<string, string>; textContent: string }> = []
    let installed: { dataset: Record<string, string>; textContent: string } | null = null
    const doc = {
      head: {
        querySelector: (selector: string) => {
          expect(selector).toContain('data-plugin-css')
          return installed
        },
        appendChild: (node: { dataset: Record<string, string>; textContent: string }) => {
          appended.push(node)
          installed = node
        },
      },
      createElement: () => ({ dataset: {} as Record<string, string>, textContent: '' }),
    } as unknown as Document
    ensurePersonaStyles(doc)
    ensurePersonaStyles(doc)
    expect(appended).toHaveLength(1)
    expect(appended[0]!.dataset['pluginCss']).toBe('dsh-plugin-gala/persona-backdrop')
    expect(appended[0]!.textContent).toBe(PERSONA_READABILITY_CSS)
  })
})
