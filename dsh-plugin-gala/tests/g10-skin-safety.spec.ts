import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGalaSkinService, sanitizeSkinCss, serializeSkinTokens } from '../src/gala-skin.ts'
import type { GalaSkinHost, GalaSkinStore } from '../src/gala-skin.ts'
import type { SkinManifest } from '../src/protocols/skin-protocol.ts'

/** 创建 fake 宿主，readCss 从指定目录读取文件 */
function createFakeHost(cssDir: string, store?: GalaSkinStore): GalaSkinHost & {
  injected: Array<{ key: string; css: string }>
} {
  let counter = 0
  const injected: Array<{ key: string; css: string }> = []
  const memoryStore: GalaSkinStore = {
    getActive: () => undefined,
    setActive: () => {},
  }
  return {
    injected,
    insertCss: async (css: string) => {
      const key = `skin-key-${++counter}`
      injected.push({ key, css })
      return key
    },
    removeCss: async () => {},
    readCss: (path: string) => readFileSync(join(cssDir, path), 'utf8'),
    store: store ?? memoryStore,
  }
}

describe('G10 · 危险 CSS 被白名单拦截', () => {
  it('sanitizeSkinCss 丢弃 position:fixed 声明', () => {
    const css = `:root {
  --gala-color-primary: #0077be;
  position: fixed;
  --gala-color-background: #e0f7fa;
}`
    const sanitized = sanitizeSkinCss(css)
    expect(sanitized).toContain('--gala-color-primary')
    expect(sanitized).toContain('--gala-color-background')
    expect(sanitized).not.toMatch(/position\s*:\s*fixed/i)
  })

  it('sanitizeSkinCss 丢弃 !important 值', () => {
    const css = `:root {
  --gala-color-primary: red !important;
  --gala-color-secondary: #00a8cc;
}`
    const sanitized = sanitizeSkinCss(css)
    expect(sanitized).not.toContain('!important')
    expect(sanitized).toContain('--gala-color-secondary')
    expect(sanitized).not.toContain('--gala-color-primary')
  })

  it('sanitizeSkinCss 丢弃 url() 远程资源引用', () => {
    const css = `:root {
  --gala-color-primary: #0077be;
  --gala-background: url(http://evil.com/bg.png);
}`
    const sanitized = sanitizeSkinCss(css)
    expect(sanitized).not.toContain('url(')
    expect(sanitized).toContain('--gala-color-primary')
    expect(sanitized).not.toContain('--gala-background')
  })

  it('sanitizeSkinCss 丢弃 infinite 无限循环动画', () => {
    const css = `:root {
  --gala-color-primary: #0077be;
  --gala-animation: spin 1s infinite;
}`
    const sanitized = sanitizeSkinCss(css)
    expect(sanitized).not.toContain('infinite')
    expect(sanitized).toContain('--gala-color-primary')
  })

  it('sanitizeSkinCss 丢弃非 :root 规则（iframe/webview 选择器）', () => {
    const css = `:root { --gala-color-primary: #0077be; }
iframe { display: none; }
webview { position: fixed; }
.button { position: fixed !important; }`
    const sanitized = sanitizeSkinCss(css)
    expect(sanitized).toContain('--gala-color-primary')
    expect(sanitized).not.toMatch(/iframe/i)
    expect(sanitized).not.toMatch(/webview/i)
    expect(sanitized).not.toMatch(/\.button/i)
    expect(sanitized).not.toMatch(/position\s*:\s*fixed/i)
  })

  it('apply 时危险 CSS 文件内容被过滤，安全声明仍注入', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'g10-'))
    // 写入含危险内容的 CSS 文件
    writeFileSync(join(dir, 'tokens.css'), `:root {
  --gala-color-primary: #0077be;
  --gala-dangerous: red !important;
  position: fixed;
}
iframe { display: none; }
body { background: url(http://evil.com/bg.png); }`)

    const skinManifest: SkinManifest = {
      id: 'gala:danger-test',
      name: '安全测试皮肤',
      type: 'skin',
      family: 'test',
      rarity: 'common',
      description: '测试白名单过滤。',
      target: 'dsh-web-app',
      scope: 'global',
      tokens: { '--gala-color-secondary': '#00a8cc' },
      css: './tokens.css',
      author: 'test',
      version: '1.0.0',
    }

    const host = createFakeHost(dir)
    const skin = createGalaSkinService({ host })
    skin.register(skinManifest)

    await skin.apply('gala:danger-test')

    const injectedCss = host.injected[0]!.css
    // 安全声明通过
    expect(injectedCss).toContain('--gala-color-primary: #0077be')
    expect(injectedCss).toContain('--gala-color-secondary: #00a8cc')
    // 危险内容被拦截
    expect(injectedCss).not.toContain('!important')
    expect(injectedCss).not.toContain('url(')
    expect(injectedCss).not.toMatch(/position\s*:\s*fixed/i)
    expect(injectedCss).not.toMatch(/iframe/i)
    // 皮肤仍成功启用
    expect(skin.current()?.id).toBe('gala:danger-test')
  })

  it('serializeSkinTokens 对全部非法 tokens 抛错', () => {
    expect(() => serializeSkinTokens({})).toThrow(/白名单/)
    expect(() => serializeSkinTokens({ 'color': 'red' })).toThrow(/白名单/)
    expect(() => serializeSkinTokens({ '--gala-x': 'red !important' })).toThrow(/白名单/)
  })
})
