import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  FishLogo: ({ size }: { size: number }) => createElement('svg', { 'data-fish-size': size }),
  BrandWordmark: () => createElement('svg', { 'data-wordmark': true }),
}))

import {
  GalaBrandMarkView,
  GalaBrandNameView,
  parsePickerLogo,
  registerGalaBrandSlots,
  startGalaBrandSync,
  type GalaLogoInfo,
} from '../src/client/gala-brand.tsx'

const LINGLING: GalaLogoInfo = { art: '/lingling.webp', name: '灵灵' }

describe('Gala brand slots', () => {
  it('角色状态渲染头像和角色名，默认状态回退官方品牌', () => {
    const mark = renderToStaticMarkup(createElement(GalaBrandMarkView, { logo: LINGLING, size: 24 }))
    const name = renderToStaticMarkup(createElement(GalaBrandNameView, { logo: LINGLING }))
    const fallbackMark = renderToStaticMarkup(createElement(GalaBrandMarkView, { logo: null, size: 24 }))
    const fallbackName = renderToStaticMarkup(createElement(GalaBrandNameView, { logo: null }))

    expect(mark).toContain('src="/lingling.webp"')
    expect(mark).toContain('alt="灵灵"')
    expect(name).toContain('灵灵')
    expect(fallbackMark).toContain('<svg')
    expect(fallbackName).toContain('data-wordmark')
  })

  it('以 -1 优先级注册三个官方品牌座位', () => {
    const registrations: unknown[] = []
    const ctx = {
      slots: {
        inject: (_name: string, callback: () => unknown) => callback(),
        register: (options: unknown) => {
          registrations.push(options)
          return () => {}
        },
      },
    }
    registerGalaBrandSlots(ctx as never)
    expect(registrations).toEqual([
      { name: 'sidebar.brand.mark', priority: -1 },
      { name: 'sidebar.brand.name', priority: -1 },
      { name: 'conversation.hero.brand.mark', priority: -1 },
    ])
  })
})

describe('Gala brand state', () => {
  it('拒绝外链头像并在皮肤事件后刷新', async () => {
    expect(parsePickerLogo({ picker: { logo: { art: 'https://evil.example/x.png', name: 'x' } } })).toBeNull()
    const snapshots: (GalaLogoInfo | null)[] = []
    let listener: ((event: { data: unknown }) => void) | undefined
    const payloads = [
      { picker: { logo: LINGLING } },
      { picker: { logo: null } },
    ]
    const stop = startGalaBrandSync({
      publish: logo => { snapshots.push(logo) },
      fetchImpl: vi.fn(async () => new Response(JSON.stringify(payloads.shift()), { status: 200 })) as never,
      eventSource: () => ({
        close: () => {},
        addEventListener: (_type, callback) => { listener = callback },
      }),
    })
    await vi.waitFor(() => { expect(snapshots).toEqual([LINGLING]) })
    listener?.({ data: 'skin-changed' })
    await vi.waitFor(() => { expect(snapshots).toEqual([LINGLING, null]) })
    stop()
  })
})
