import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  StateDot: () => createElement('span', { 'data-state': 'error' }),
}))

import {
  classifyTurnError,
  DEEPSEEK_BALANCE_URL,
  DesktopTurnErrorView,
} from '../src/client/turn-error/DesktopTurnErrorView.tsx'
import {
  DESKTOP_CONVERSATION_LOCALES,
  DESKTOP_CONVERSATION_NS,
} from '../src/client/turn-error/locales.ts'

function render(code: string | undefined, message: string, locale: 'zh' | 'en'): string {
  const dict = DESKTOP_CONVERSATION_LOCALES[locale]
  const t = (key: keyof typeof dict): string => dict[key]
  return renderToStaticMarkup(createElement(DesktopTurnErrorView, {
    node: {
      kind: 'turn-error',
      key: 'turn-error:1',
      seq: 1,
      data: { kind: 'turn-error', seq: 1, time: 1, turn: 1, step: 1, message, ...(code === undefined ? {} : { code }) },
    },
    t,
  } as never))
}

describe('turn error classification', () => {
  it('识别 QUOTA、HTTP_402 与余额不足消息，但不误判认证和限速', () => {
    expect(classifyTurnError({ code: 'QUOTA', message: 'x' })).toBe('quota')
    expect(classifyTurnError({ code: 'HTTP_402', message: 'x' })).toBe('quota')
    expect(classifyTurnError({ message: 'Insufficient Balance' })).toBe('quota')
    expect(classifyTurnError({ code: 'AUTH', message: 'API key is invalid' })).toBe('generic')
    expect(classifyTurnError({ code: 'RATE_LIMIT', message: 'too many requests' })).toBe('generic')
  })

  it('中英文字典键集合完全一致', () => {
    expect(Object.keys(DESKTOP_CONVERSATION_LOCALES.zh).sort())
      .toEqual(Object.keys(DESKTOP_CONVERSATION_LOCALES.en).sort())
    expect(DESKTOP_CONVERSATION_NS).toBe('desktop.conversation')
  })
})

describe('DesktopTurnErrorView', () => {
  it('余额不足显示充值入口、错误码和折叠原文', () => {
    const html = render('QUOTA', 'Insufficient Balance', 'zh')
    expect(html).toContain('余额不足')
    expect(html).toContain(DEEPSEEK_BALANCE_URL)
    expect(html).toContain('<code>QUOTA</code>')
    expect(html).toContain('<details')
  })

  it('普通错误保留原文且没有充值入口', () => {
    const html = render('AUTH', 'API key is invalid', 'en')
    expect(html).toContain('This turn failed')
    expect(html).toContain('API key is invalid')
    expect(html).not.toContain(DEEPSEEK_BALANCE_URL)
  })
})
