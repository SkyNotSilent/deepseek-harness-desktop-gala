import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createGalaLayer, type GalaNative } from '../src/gala-host.ts'
import { createGalaHttpHandler, GALA_HTTP_PREFIX } from '../src/gala-http.ts'
import { panelViewModel, renderPanelPage } from '../src/gala-panel-page.ts'

const ORIGIN = 'http://127.0.0.1:5173'
const workspaces: string[] = []

function request(method: string, url: string, body?: string): IncomingMessage {
  const req = new EventEmitter() as unknown as IncomingMessage & {
    [Symbol.asyncIterator](): AsyncIterator<Buffer>
  }
  Object.assign(req, {
    method,
    url,
    headers: method === 'POST'
      ? { origin: ORIGIN, 'content-type': 'application/json' }
      : {},
  })
  const chunks = body === undefined ? [] : [Buffer.from(body)]
  req[Symbol.asyncIterator] = async function* () { yield* chunks }
  return req
}

interface FakeResponse extends ServerResponse {
  chunks: string[]
  body(): string
}

function response(): FakeResponse {
  const res = new EventEmitter() as unknown as FakeResponse
  res.statusCode = 200
  res.chunks = []
  res.setHeader = (() => res) as FakeResponse['setHeader']
  res.end = ((chunk?: unknown) => {
    if (chunk !== undefined) res.chunks.push(String(chunk))
    return res
  }) as FakeResponse['end']
  res.body = () => res.chunks.join('')
  return res
}

afterEach(() => {
  for (const root of workspaces.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('G21 · 合成工坊装配验收', () => {
  it('渲染官方配方并经 RPC 完成确认、写 bundles 与重启', async () => {
    const root = mkdtempSync(join(tmpdir(), 'g21-fusion-panel-'))
    workspaces.push(root)
    mkdirSync(join(root, 'profile'), { recursive: true })
    let bundles: readonly string[] = []
    let confirmMessage = ''
    let relaunched = false
    const native: GalaNative = {
      insertCss: async () => 'key',
      removeCss: async () => {},
      openPanel: () => {},
      confirm: async message => {
        confirmMessage = message
        return true
      },
      chooseGgal: async () => undefined,
      resolveConflict: async () => ({ action: 'skip' }),
      notify: () => {},
      relaunch: () => { relaunched = true },
    }
    const layer = createGalaLayer({
      userDataDir: join(root, 'user-data'),
      profileDir: join(root, 'profile'),
      packages: [],
      bundles: { read: () => bundles, write: next => { bundles = next } },
      native,
    })
    const handler = createGalaHttpHandler({
      origin: ORIGIN,
      renderPanel: (view, nonce) => renderPanelPage(panelViewModel(layer, view), nonce),
      assetRoot: id => layer.assetRoot(id),
      skinTokens: () => layer.skinTokens(),
      pickerState: () => layer.pickerState(),
      events: layer.events,
      nonce: () => 'g21-nonce',
      rpc: {
        open: view => native.openPanel(view),
        toggleFavorite: id => layer.gallery.toggleFavorite(id),
        applySkin: id => layer.skin.apply(id),
        revertSkin: () => layer.skin.revert(),
        importPackage: () => layer.importPackage(),
        compose: id => layer.compose.compose(id),
      },
    })

    const page = response()
    await handler(request('GET', `${GALA_HTTP_PREFIX}/panel?view=compose`), page)
    expect(page.statusCode).toBe(200)
    expect(page.body()).toContain('data-recipe-id="gala:atelier-duo"')
    expect(page.body()).toContain('data-compose-id="gala:atelier-duo"')

    const rpc = response()
    await handler(
      request('POST', `${GALA_HTTP_PREFIX}/rpc/compose`, '{"id":"gala:atelier-duo"}'),
      rpc,
    )
    expect(rpc.statusCode).toBe(200)
    expect(JSON.parse(rpc.body())).toEqual({ ok: true, composed: true })
    expect(confirmMessage).toContain('大嘎啦·全栈工坊')
    expect(bundles).toEqual(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
    expect(relaunched).toBe(true)
  })
})
