import { createServer, type Server } from 'node:http'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { applyWebFetchTool } from '@deepseek-ai/dsh-tool-web'
import { HttpFetchProvider } from '@deepseek-ai/dsh-web-fetch-http'
import { WebError } from '@deepseek-ai/dsh-web'
import { shippedPresetRoot } from '../src/profile.ts'

const servers: Server[] = []
const limits = {
  maxResponseBytes: 16_384,
  maxBodyChars: 8_192,
  timeoutMs: 5_000,
  maxRedirects: 3,
  userAgent: 'dsh-desktop-alpha2-policy-test',
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => { if (error === undefined) resolve(); else reject(error) })
  })))
})

function presetToolWeb(preset: string): Record<string, unknown> | undefined {
  const rows = parse(readFileSync(
    `${shippedPresetRoot()}/${preset}/agent.cordis.yml`,
    'utf8',
  )) as Array<Record<string, unknown>>
  return rows.find(row => row.id === 'tool-web')
}

function registerPresetFetch(
  preset: string,
  provider: HttpFetchProvider,
  approvalRequest: ReturnType<typeof vi.fn>,
): ToolDefinition | undefined {
  const row = presetToolWeb(preset)
  const config = row?.config as { fetch?: boolean } | undefined
  if (config?.fetch !== true) return undefined
  let definition: ToolDefinition | undefined
  const context = {
    web: { fetch: (request: { url: string }, signal: AbortSignal) => provider.fetch(request, signal) },
    tools: { register: (value: ToolDefinition) => { definition = value } },
    systemPrompt: {
      getSectionOrder: () => 0,
      section: () => {},
    },
    approval: { request: approvalRequest },
  }
  applyWebFetchTool(context as unknown as Context, 5_000, 8_192)
  return definition
}

async function listenMock(): Promise<{ port: number }> {
  const server = createServer((request, response) => {
    if (request.url === '/ok') {
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('mock public response 中文')
      return
    }
    if (request.url === '/redirect-private') {
      response.writeHead(302, { location: '/private' })
      response.end()
      return
    }
    response.writeHead(200, { 'content-type': 'text/plain' })
    response.end('private redirect target must never be read')
  })
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('mock server did not bind a TCP port')
  return { port: address.port }
}

describe('alpha.2 WebFetch product policy', () => {
  it('executes a standard-preset public HTTP mock without requesting approval and omits minimal', async () => {
    const { port } = await listenMock()
    const resolver = vi.fn(async (hostname: string) => {
      expect(hostname).toBe('public.example')
      return [{ address: '127.0.0.1', family: 4 as const }]
    })
    const provider = new HttpFetchProvider(limits, resolver)
    const approvalRequest = vi.fn(async () => 'allowed-once')
    const standard = registerPresetFetch('standard', provider, approvalRequest)

    expect(standard?.name).toBe('web_fetch')
    const result = await standard!.execute(
      { url: `http://public.example:${port}/ok` },
      { signal: new AbortController().signal } as Parameters<ToolDefinition['execute']>[1],
    )
    expect(result).toEqual({
      url: `http://public.example:${port}/ok`,
      statusCode: 200,
      body: { kind: 'text', content: 'mock public response 中文' },
      truncated: false,
    })
    expect(resolver).toHaveBeenCalledOnce()
    expect(approvalRequest).not.toHaveBeenCalled()
    expect(registerPresetFetch('minimal', provider, approvalRequest)).toBeUndefined()
  })

  it('rejects invalid schemes and literal private destinations before HTTP dispatch', async () => {
    const resolver = vi.fn(async () => [{ address: '93.184.216.34', family: 4 as const }])
    const provider = new HttpFetchProvider(limits, resolver)
    await expect(provider.fetch(
      { url: 'file:///etc/passwd' },
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'WEB_INVALID_URL' })
    expect(resolver).not.toHaveBeenCalled()

    const productionPolicy = new HttpFetchProvider(limits)
    await expect(productionPolicy.fetch(
      { url: 'http://127.0.0.1/private' },
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'WEB_BLOCKED_URL' })
  })

  it('revalidates every same-origin redirect and blocks a second-hop private resolution', async () => {
    const { port } = await listenMock()
    let resolution = 0
    const provider = new HttpFetchProvider(limits, async (hostname) => {
      expect(hostname).toBe('public.example')
      resolution += 1
      if (resolution === 1) return [{ address: '127.0.0.1', family: 4 }]
      throw new WebError('mock DNS rebinding resolved to a private address', 'WEB_BLOCKED_URL')
    })

    await expect(provider.fetch(
      { url: `http://public.example:${port}/redirect-private` },
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'WEB_BLOCKED_URL' })
    expect(resolution).toBe(2)
  })

  it('pins the executable policy test to the vendored alpha.2 packages and registry integrities', () => {
    const root = fileURLToPath(new URL('../../', import.meta.url))
    const manifest = JSON.parse(readFileSync(
      `${root}/vendor/dsh-runtime/0.1.2-alpha.2/manifest.json`,
      'utf8',
    )) as { packages: Array<{ name: string, integrity: string }> }
    const packages = new Map(manifest.packages.map(entry => [entry.name, entry.integrity]))
    expect(packages.get('@deepseek-ai/dsh-tool-web')).toBe(
      'sha512-Us4xXhNctr34Em8QbUkdI+65KutXapHH96Xb2NUuO2LygIW80ajBDnlw7B5WClEz9EtzQZtz8RHmrMZDYaVmDQ==',
    )
    expect(packages.get('@deepseek-ai/dsh-web-fetch-http')).toBe(
      'sha512-/HtQrHxrRdipFDJ8p1H55plB0J2AY8eF17svS7lUzbV228g7ZWM1PSuwUyBlPcJ2JPI1e4BuVT5oAqK1VI5WPQ==',
    )
    for (const name of ['dsh-tool-web', 'dsh-web-fetch-http']) {
      const installed = JSON.parse(readFileSync(
        `${fileURLToPath(new URL('../node_modules/@deepseek-ai/', import.meta.url))}${name}/package.json`,
        'utf8',
      )) as { version: string }
      expect(installed.version).toBe('0.1.2-alpha.2')
    }
  })
})
