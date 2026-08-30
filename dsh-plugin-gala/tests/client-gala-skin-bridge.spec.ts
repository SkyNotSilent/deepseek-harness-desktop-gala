import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import {
  parseSkinTokens,
  SKIN_OVERRIDE_SOURCE,
  startGalaSkinBridge,
} from '../src/client/gala-skin-bridge.ts'

const LAYER = { '--dsw-alias-brand-primary': { light: '#111111', dark: '#eeeeee' } }

interface FakeEventSource {
  close(): void
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
  emit(data: string): void
  closed: boolean
}

function createFakes(initialTokens: object) {
  let tokens: object = initialTokens
  const overrides: { source: string; tokens: object }[] = []
  let disposed = 0
  const theme = {
    overrideTokens: (source: string, layer: object) => {
      overrides.push({ source, tokens: layer })
      return () => { disposed += 1 }
    },
  }
  const ctx = { theme } as unknown as Context
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ ok: true, tokens }), { status: 200 })) as typeof fetch

  const listeners: ((event: { data: unknown }) => void)[] = []
  const source: FakeEventSource = {
    closed: false,
    close: () => { source.closed = true },
    addEventListener: (type, listener) => {
      if (type === 'message') listeners.push(listener)
    },
    emit: data => { for (const listener of listeners) listener({ data }) },
  }
  const setTokens = (next: object): void => { tokens = next }
  return { ctx, fetchImpl, source, overrides, disposedCount: () => disposed, setTokens }
}

const tick = async (): Promise<void> => { await new Promise(resolve => setTimeout(resolve, 10)) }

describe('皮肤桥（client · overrideTokens 路径）', () => {
  it('boot 取层并以固定 source 调 overrideTokens', async () => {
    const fakes = createFakes(LAYER)
    const stop = startGalaSkinBridge(fakes.ctx, {
      fetchImpl: fakes.fetchImpl,
      eventSource: () => fakes.source,
    })
    await tick()

    expect(fakes.overrides).toHaveLength(1)
    expect(fakes.overrides[0]?.source).toBe(SKIN_OVERRIDE_SOURCE)
    expect(fakes.overrides[0]?.tokens).toEqual(LAYER)
    stop()
  })

  it('skin-changed 事件触发重取；同 source 整层替换（旧层 disposer 被调）', async () => {
    const fakes = createFakes(LAYER)
    const stop = startGalaSkinBridge(fakes.ctx, {
      fetchImpl: fakes.fetchImpl,
      eventSource: () => fakes.source,
    })
    await tick()

    fakes.setTokens({ '--dsw-alias-bg-base': { light: '#ffffff', dark: '#101010' } })
    fakes.source.emit('skin-changed')
    await tick()

    expect(fakes.overrides).toHaveLength(2)
    expect(fakes.disposedCount()).toBe(1) // 旧层已撤
    stop()
  })

  it('空层 = 皮肤移除：撤销覆盖且不再注册新层', async () => {
    const fakes = createFakes(LAYER)
    const stop = startGalaSkinBridge(fakes.ctx, {
      fetchImpl: fakes.fetchImpl,
      eventSource: () => fakes.source,
    })
    await tick()

    fakes.setTokens({})
    fakes.source.emit('skin-changed')
    await tick()

    expect(fakes.overrides).toHaveLength(1)
    expect(fakes.disposedCount()).toBe(1)
    stop()
  })

  it('清理函数关 SSE 并撤销当前层', async () => {
    const fakes = createFakes(LAYER)
    const stop = startGalaSkinBridge(fakes.ctx, {
      fetchImpl: fakes.fetchImpl,
      eventSource: () => fakes.source,
    })
    await tick()
    stop()

    expect(fakes.source.closed).toBe(true)
    expect(fakes.disposedCount()).toBe(1)
  })

  it('Gala 层不可用（fetch 抛错 / 404）时静默不生效', async () => {
    const fakes = createFakes(LAYER)
    const failing = (async () => {
      throw new Error('connection refused')
    }) as typeof fetch
    const stop = startGalaSkinBridge(fakes.ctx, { fetchImpl: failing, eventSource: () => fakes.source })
    await tick()

    expect(fakes.overrides).toHaveLength(0)
    stop()
  })
})

describe('skin-tokens 响应解析', () => {
  it('过滤非 --dsw- 键与坏结构', () => {
    expect(
      parseSkinTokens({
        tokens: {
          '--dsw-alias-brand-primary': { light: '#111111', dark: '#eeeeee' },
          '--evil-key': { light: 'a', dark: 'b' },
          '--dsw-alias-bg-base': { light: '#ffffff' }, // 缺 dark
        },
      }),
    ).toEqual({ '--dsw-alias-brand-primary': { light: '#111111', dark: '#eeeeee' } })
    expect(parseSkinTokens(null)).toEqual({})
    expect(parseSkinTokens({ tokens: 'nope' })).toEqual({})
  })
})
