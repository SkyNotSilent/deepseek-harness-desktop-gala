import { describe, expect, it } from 'vitest'
import {
  createEnvArtworkProvider,
  artworkPrompt,
  DEFAULT_ART_API_URL,
} from '../src/gala-artwork.ts'
import { fnv1a, galaSvgDataUrl, renderGalaSvg } from '../src/gala-avatar.ts'
import { OFFICIAL_GALAS } from '../src/gala-officials.ts'
import { sampleCharacter } from './helpers/ggal-fixture.ts'

describe('程序化嘎啦形象（软萌 SVG）', () => {
  it('同一 id 两次渲染字节级一致（形象稳定）', () => {
    const character = { id: 'gala:dsh-base', family: 'core', rarity: 'rare' as const }
    expect(renderGalaSvg(character)).toBe(renderGalaSvg(character))
  })

  it('不同 id 产出不同形体', () => {
    const a = renderGalaSvg({ id: 'gala:aaa-one', family: 'core', rarity: 'common' })
    const b = renderGalaSvg({ id: 'gala:bbb-two', family: 'core', rarity: 'common' })
    expect(a).not.toBe(b)
  })

  it('family 决定配色，rarity 决定光环', () => {
    const mint = renderGalaSvg({ id: 'gala:same-id', family: 'craft', rarity: 'common' })
    const lavender = renderGalaSvg({ id: 'gala:same-id', family: 'mind', rarity: 'common' })
    expect(mint).toContain('#8fdcba')
    expect(lavender).toContain('#bda6ff')

    const plain = renderGalaSvg({ id: 'gala:same-id', family: 'mind', rarity: 'common' })
    const legendary = renderGalaSvg({ id: 'gala:same-id', family: 'mind', rarity: 'legendary' })
    expect(plain).not.toContain('stroke-dasharray')
    expect(legendary).toContain('#ffd166')
  })

  it('未知族系稳定回退到内置配色表（不抛错、可复现）', () => {
    const character = { id: 'gala:stranger', family: 'weird-family', rarity: 'common' as const }
    expect(renderGalaSvg(character)).toBe(renderGalaSvg(character))
  })

  it('四种表情产出不同面部', () => {
    const base = { id: 'gala:face', family: 'core', rarity: 'common' as const }
    const faces = new Set(
      (['idle', 'happy', 'sleepy', 'surprised'] as const).map(expression =>
        renderGalaSvg(base, expression),
      ),
    )
    expect(faces.size).toBe(4)
  })

  it('SVG 无脚本无外链（自包含安全）', () => {
    for (const entry of OFFICIAL_GALAS) {
      const svg = renderGalaSvg(entry.character)
      expect(svg).not.toContain('<script')
      expect(svg).not.toContain('href')
      // xmlns 命名空间是唯一允许的 http 出现
      expect(svg.replaceAll('http://www.w3.org/2000/svg', '')).not.toMatch(/https?:/)
    }
  })

  it('data URL 形式可直接内联 <img>', () => {
    const url = galaSvgDataUrl({ id: 'gala:dsh-base', family: 'core', rarity: 'rare' })
    expect(url.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true)
  })

  it('fnv1a 稳定且区分输入', () => {
    expect(fnv1a('gala:a')).toBe(fnv1a('gala:a'))
    expect(fnv1a('gala:a')).not.toBe(fnv1a('gala:b'))
  })
})

describe('生图 API 适配器（Agnes / 回退）', () => {
  const character = sampleCharacter()

  it('未配置 key 时直接回退 SVG', async () => {
    const provider = createEnvArtworkProvider({ env: {} })
    const artwork = await provider.generate(character, 'idle')
    expect(artwork.source).toBe('fallback')
    expect(artwork.format).toBe('svg')
    expect(artwork.data.toString('utf8')).toContain('<svg')
  })

  it('API 成功时返回 png 字节（b64_json 路径）', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    const requests: { url: string; init: RequestInit }[] = []
    const provider = createEnvArtworkProvider({
      env: { GALA_ART_API_KEY: 'sk-test' },
      fetchImpl: (async (url: string, init: RequestInit) => {
        requests.push({ url, init })
        return new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }), { status: 200 })
      }) as typeof fetch,
    })

    const artwork = await provider.generate(character, 'happy')
    expect(artwork.source).toBe('api')
    expect(artwork.data.equals(png)).toBe(true)
    expect(requests[0]?.url).toBe(DEFAULT_ART_API_URL)
    const headers = requests[0]?.init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer sk-test')
  })

  it('API 报错时回退 SVG 而不是抛出', async () => {
    const waits: number[] = []
    const provider = createEnvArtworkProvider({
      env: { GALA_ART_API_KEY: 'sk-test' },
      fetchImpl: (async () => new Response('nope', { status: 500 })) as typeof fetch,
      sleep: async milliseconds => { waits.push(milliseconds) },
    })
    const artwork = await provider.generate(character, 'idle')
    expect(artwork.source).toBe('fallback')
    expect(waits).toEqual([3000])
  })

  it('prompt 携带统一风格规范与角色设定', () => {
    const prompt = artworkPrompt(character, 'sleepy')
    expect(prompt).toContain(character.name)
    expect(prompt).toContain('galgame')
    expect(prompt).toContain('anime bishoujo portrait')
    expect(prompt).toContain('困倦')
  })
})
