import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createGalaEventHub,
  createGalaHttpHandler,
  GALA_HTTP_PREFIX,
  type GalaHttpOptions,
} from '../src/gala-http.ts'

const ORIGIN = 'http://127.0.0.1:5173'
const workspaces: string[] = []

/** 极简 req/res fake（够 handler 用即可） */
function fakeRequest(
  method: string,
  url: string,
  headers: Record<string, string> = {},
  body?: string,
): IncomingMessage {
  const emitter = new EventEmitter() as unknown as IncomingMessage & {
    [Symbol.asyncIterator](): AsyncIterator<Buffer>
  }
  Object.assign(emitter, { method, url, headers })
  const chunks = body === undefined ? [] : [Buffer.from(body, 'utf8')]
  emitter[Symbol.asyncIterator] = async function* () { yield* chunks }
  return emitter
}

interface FakeResponse extends ServerResponse {
  statusCode: number
  chunks: string[]
  headers: Record<string, unknown>
  ended: boolean
  body(): string
}

function fakeResponse(): FakeResponse {
  const res = new EventEmitter() as unknown as FakeResponse
  res.statusCode = 200
  res.chunks = []
  res.headers = {}
  res.ended = false
  res.setHeader = ((name: string, value: unknown) => {
    res.headers[name.toLowerCase()] = value
    return res
  }) as FakeResponse['setHeader']
  res.writeHead = ((status: number, headers?: Record<string, unknown>) => {
    res.statusCode = status
    Object.assign(res.headers, headers ?? {})
    return res
  }) as FakeResponse['writeHead']
  res.write = ((chunk: unknown) => {
    res.chunks.push(String(chunk))
    return true
  }) as FakeResponse['write']
  res.end = ((chunk?: unknown) => {
    if (chunk !== undefined) res.chunks.push(String(chunk))
    res.ended = true
    return res
  }) as FakeResponse['end']
  res.body = () => res.chunks.join('')
  return res
}

function makeHandler(overrides: Partial<GalaHttpOptions> = {}) {
  const events = createGalaEventHub()
  const calls: Record<string, unknown[]> = {}
  const record = (name: string, ...args: unknown[]) => {
    ;(calls[name] ??= []).push(args)
  }
  const options: GalaHttpOptions = {
    origin: ORIGIN,
    renderPanel: (view, nonce) => `<html data-view="${view}" data-nonce="${nonce}"></html>`,
    assetRoot: () => undefined,
    skinTokens: () => ({ '--dsw-alias-brand-primary': { light: '#111111', dark: '#eeeeee' } }),
    pickerState: () => ({ girls: [], classics: [], activeSkinId: null, logo: null }),
    events,
    nonce: () => 'test-nonce',
    rpc: {
      open: view => record('open', view),
      toggleFavorite: id => {
        record('favorite', id)
        return true
      },
      applySkin: async id => record('applySkin', id),
      revertSkin: async () => record('revertSkin'),
      importPackage: async () => {
        record('import')
        return true
      },
      compose: async id => {
        record('compose', id)
        return true
      },
    },
    ...overrides,
  }
  return { handler: createGalaHttpHandler(options), events, calls }
}

const path = (sub: string): string => `${GALA_HTTP_PREFIX}${sub}`

afterEach(() => {
  for (const root of workspaces.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Gala HTTP · 面板与静态端点', () => {
  it('GET /panel 返回页面并带 nonce CSP 头', async () => {
    const { handler } = makeHandler()
    const res = fakeResponse()
    await handler(fakeRequest('GET', path('/panel?view=skins')), res)

    expect(res.statusCode).toBe(200)
    expect(res.body()).toContain('data-view="skins"')
    expect(res.body()).toContain('data-nonce="test-nonce"')
    const csp = String(res.headers['content-security-policy'])
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("script-src 'nonce-test-nonce'")
    expect(csp).toContain(`connect-src ${ORIGIN}`)
  })

  it('GET /skin-tokens 返回当前映射层', async () => {
    const { handler } = makeHandler()
    const res = fakeResponse()
    await handler(fakeRequest('GET', path('/skin-tokens')), res)

    const payload = JSON.parse(res.body()) as { ok: boolean; tokens: Record<string, unknown> }
    expect(payload.ok).toBe(true)
    expect(payload.tokens['--dsw-alias-brand-primary']).toEqual({ light: '#111111', dark: '#eeeeee' })
  })

  it('GET /picker 返回选肤状态（no-store）', async () => {
    const { handler } = makeHandler({
      pickerState: () => ({
        girls: [{ skinId: 'gala:skin-dsh-llm', name: '灵灵', active: true }],
        classics: [],
        activeSkinId: 'gala:skin-dsh-llm',
        logo: { art: '/x.png', name: '灵灵' },
      }),
    })
    const res = fakeResponse()
    await handler(fakeRequest('GET', path('/picker')), res)

    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).toBe('no-store')
    const payload = JSON.parse(res.body()) as {
      ok: boolean
      picker: { girls: { skinId: string }[]; logo: { name: string } }
    }
    expect(payload.ok).toBe(true)
    expect(payload.picker.girls[0]?.skinId).toBe('gala:skin-dsh-llm')
    expect(payload.picker.logo.name).toBe('灵灵')
  })

  it('未知路径 404；面板路径非 GET 405', async () => {
    const { handler } = makeHandler()
    const notFound = fakeResponse()
    await handler(fakeRequest('GET', path('/nope')), notFound)
    expect(notFound.statusCode).toBe(404)

    const wrongMethod = fakeResponse()
    await handler(fakeRequest('PUT', path('/panel')), wrongMethod)
    expect(wrongMethod.statusCode).toBe(405)
  })
})

describe('Gala HTTP · 资产端点', () => {
  function assetWorkspace() {
    const root = mkdtempSync(join(tmpdir(), 'gala-asset-'))
    workspaces.push(root)
    mkdirSync(join(root, 'assets'), { recursive: true })
    writeFileSync(join(root, 'assets', 'avatar.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    return root
  }

  it('已知包 + 包内相对路径返回文件流', async () => {
    const root = assetWorkspace()
    const { handler } = makeHandler({ assetRoot: id => (id === 'gala:x' ? root : undefined) })
    const res = fakeResponse()
    await handler(fakeRequest('GET', path('/asset?pkg=gala:x&path=assets/avatar.png')), res)
    await new Promise(resolve => setTimeout(resolve, 20)) // 等 pipe 完成

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
  })

  it('路径穿越与未知包被拒绝', async () => {
    const root = assetWorkspace()
    const { handler } = makeHandler({ assetRoot: id => (id === 'gala:x' ? root : undefined) })

    const traversal = fakeResponse()
    await handler(fakeRequest('GET', path('/asset?pkg=gala:x&path=../../etc/passwd')), traversal)
    expect(traversal.statusCode).toBe(400)

    const unknown = fakeResponse()
    await handler(fakeRequest('GET', path('/asset?pkg=gala:y&path=assets/avatar.png')), unknown)
    expect(unknown.statusCode).toBe(404)
  })

  it('脚本类扩展名拒绝服务（§15 仅图片/CSS/JSON）', async () => {
    const root = assetWorkspace()
    writeFileSync(join(root, 'evil.js'), 'alert(1)')
    const { handler } = makeHandler({ assetRoot: () => root })
    const res = fakeResponse()
    await handler(fakeRequest('GET', path('/asset?pkg=gala:x&path=evil.js')), res)
    expect(res.statusCode).toBe(415)
  })
})

describe('Gala HTTP · RPC', () => {
  const JSON_HEADERS = { origin: ORIGIN, 'content-type': 'application/json' }

  it('Origin 不符 403；content-type 不符 415；非 POST 405', async () => {
    const { handler } = makeHandler()

    const badOrigin = fakeResponse()
    await handler(
      fakeRequest('POST', path('/rpc/open'), { origin: 'http://evil.example', 'content-type': 'application/json' }, '{}'),
      badOrigin,
    )
    expect(badOrigin.statusCode).toBe(403)

    const badType = fakeResponse()
    await handler(fakeRequest('POST', path('/rpc/open'), { origin: ORIGIN, 'content-type': 'text/plain' }, '{}'), badType)
    expect(badType.statusCode).toBe(415)

    const badMethod = fakeResponse()
    await handler(fakeRequest('GET', path('/rpc/open'), JSON_HEADERS), badMethod)
    expect(badMethod.statusCode).toBe(405)
  })

  it('open / favorite / skin-apply / import / compose 正常分发', async () => {
    const { handler, calls } = makeHandler()

    const open = fakeResponse()
    await handler(fakeRequest('POST', path('/rpc/open'), JSON_HEADERS, '{"view":"skins"}'), open)
    expect(JSON.parse(open.body())).toEqual({ ok: true })
    expect(calls.open).toEqual([['skins']])

    const favorite = fakeResponse()
    await handler(fakeRequest('POST', path('/rpc/favorite'), JSON_HEADERS, '{"id":"gala:x"}'), favorite)
    expect(JSON.parse(favorite.body())).toEqual({ ok: true, favorite: true })

    const apply = fakeResponse()
    await handler(fakeRequest('POST', path('/rpc/skin-apply'), JSON_HEADERS, '{"id":"gala:skin-a"}'), apply)
    expect(calls.applySkin).toEqual([['gala:skin-a']])

    const importRes = fakeResponse()
    await handler(fakeRequest('POST', path('/rpc/import'), JSON_HEADERS, '{}'), importRes)
    expect(JSON.parse(importRes.body())).toEqual({ ok: true, imported: true })

    const compose = fakeResponse()
    await handler(fakeRequest('POST', path('/rpc/compose'), JSON_HEADERS, '{"id":"gala:atelier-duo"}'), compose)
    expect(JSON.parse(compose.body())).toEqual({ ok: true, composed: true })
    expect(calls.compose).toEqual([['gala:atelier-duo']])
  })

  it('RPC 抛错映射为 422 + 错误信息（换肤失败回滚提示的来源）', async () => {
    const { handler } = makeHandler({
      rpc: {
        open: () => {},
        toggleFavorite: () => true,
        applySkin: async () => {
          throw new Error('皮肤注入失败，已回滚')
        },
        revertSkin: async () => {},
        importPackage: async () => false,
        compose: async () => false,
      },
    })
    const res = fakeResponse()
    await handler(fakeRequest('POST', path('/rpc/skin-apply'), JSON_HEADERS, '{"id":"gala:bad"}'), res)

    expect(res.statusCode).toBe(422)
    expect(JSON.parse(res.body())).toEqual({ ok: false, error: '皮肤注入失败，已回滚' })
  })

  it('persona-toggle 需要布尔 enabled；缺实现 404；成功回显 enabled', async () => {
    const missing = makeHandler().handler
    const notImplemented = fakeResponse()
    await missing(fakeRequest('POST', path('/rpc/persona-toggle'), JSON_HEADERS, '{"enabled":false}'), notImplemented)
    expect(notImplemented.statusCode).toBe(404)

    const toggles: boolean[] = []
    const withPersona = makeHandler({
      rpc: {
        open: () => {},
        toggleFavorite: () => false,
        applySkin: async () => {},
        revertSkin: async () => {},
        importPackage: async () => false,
        compose: async () => false,
        setPersonaEnabled: async enabled => { toggles.push(enabled) },
      },
    }).handler
    const bad = fakeResponse()
    await withPersona(fakeRequest('POST', path('/rpc/persona-toggle'), JSON_HEADERS, '{"enabled":"no"}'), bad)
    expect(bad.statusCode).toBe(400)
    const ok = fakeResponse()
    await withPersona(fakeRequest('POST', path('/rpc/persona-toggle'), JSON_HEADERS, '{"enabled":false}'), ok)
    expect(ok.statusCode).toBe(200)
    expect(JSON.parse(ok.body())).toEqual({ ok: true, enabled: false })
    expect(toggles).toEqual([false])
  })

  it('favorite 缺 id 400', async () => {
    const { handler } = makeHandler()
    const res = fakeResponse()
    await handler(fakeRequest('POST', path('/rpc/favorite'), JSON_HEADERS, '{}'), res)
    expect(res.statusCode).toBe(400)
  })

  it('compose 缺 id 返回 400，用户取消返回 composed=false，缺素材返回 422', async () => {
    const missingIdHandler = makeHandler().handler
    const missingId = fakeResponse()
    await missingIdHandler(fakeRequest('POST', path('/rpc/compose'), JSON_HEADERS, '{}'), missingId)
    expect(missingId.statusCode).toBe(400)

    const cancel = makeHandler({
      rpc: {
        open: () => {},
        toggleFavorite: () => false,
        applySkin: async () => {},
        revertSkin: async () => {},
        importPackage: async () => false,
        compose: async () => false,
      },
    }).handler
    const canceled = fakeResponse()
    await cancel(fakeRequest('POST', path('/rpc/compose'), JSON_HEADERS, '{"id":"gala:atelier-duo"}'), canceled)
    expect(JSON.parse(canceled.body())).toEqual({ ok: true, composed: false })

    const reject = makeHandler({
      rpc: {
        open: () => {},
        toggleFavorite: () => false,
        applySkin: async () => {},
        revertSkin: async () => {},
        importPackage: async () => false,
        compose: async () => { throw new Error('gala: 缺少合成素材 gala:missing') },
      },
    }).handler
    const rejected = fakeResponse()
    await reject(fakeRequest('POST', path('/rpc/compose'), JSON_HEADERS, '{"id":"gala:broken"}'), rejected)
    expect(rejected.statusCode).toBe(422)
    expect(JSON.parse(rejected.body())).toEqual({ ok: false, error: 'gala: 缺少合成素材 gala:missing' })
  })
})

describe('Gala HTTP · SSE', () => {
  it('订阅收到事件帧；连接关闭后退订', async () => {
    const { handler, events } = makeHandler()
    const req = fakeRequest('GET', path('/events'))
    const res = fakeResponse()
    await handler(req, res)

    expect(res.headers['content-type']).toBe('text/event-stream')
    expect(res.body()).toContain('retry: 3000')
    expect(events.size()).toBe(1)

    events.publish('skin-changed')
    expect(res.body()).toContain('data: skin-changed\n\n')

    req.emit('close')
    expect(events.size()).toBe(0)
  })

  it('事件枢纽：单个订阅者抛错不影响其余广播', () => {
    const hub = createGalaEventHub()
    const seen: string[] = []
    hub.subscribe(() => { throw new Error('boom') })
    hub.subscribe(event => seen.push(event))
    hub.publish('collection-changed')
    expect(seen).toEqual(['collection-changed'])
  })
})
