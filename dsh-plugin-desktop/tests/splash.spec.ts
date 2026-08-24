import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  openSplash,
  renderSplashHtml,
  splashPresentationFromAppearance,
  SPLASH_MINIMUM_VISIBLE_MS,
  SPLASH_TIMEOUT_MS,
  type SplashPresentation,
} from '../src/splash.ts'

const TEST_ART = `data:image/png;base64,${Buffer.from('launch-art').toString('base64')}`

function presentation(overrides: Partial<SplashPresentation> = {}): SplashPresentation {
  return {
    kind: 'character',
    name: 'GALA·群星',
    message: '十位伙伴都到齐了，马上出发',
    accent: '#6758d8',
    background: '#f7f6ff',
    surface: '#eeebff',
    firstRun: true,
    recovered: false,
    artDataUrl: TEST_ART,
    ...overrides,
  }
}

describe('启动画面', () => {
  it('首次进入显示全员图片式 UI，并保留动效降噪回退', () => {
    const html = renderSplashHtml(presentation())
    expect(html).toContain('GALA·群星')
    expect(html).toContain('初次见面')
    expect(html).toContain(TEST_ART)
    expect(html).toContain('portrait')
    expect(html).toContain('prefers-reduced-motion')
    expect(html).not.toMatch(/https?:/)
  })

  it('角色名与提示按文本转义，不可注入标记', () => {
    const html = renderSplashHtml(presentation({
      name: '<b>凶"名\'</b>',
      message: '<script>no</script>',
    }))
    expect(html).toContain('&lt;b&gt;凶&quot;名&#39;&lt;/b&gt;')
    expect(html).toContain('&lt;script&gt;no&lt;/script&gt;')
    expect(html).not.toContain('<script>')
  })

  it('把本地官方角色图片嵌入自包含启动页', () => {
    const artPath = fileURLToPath(new URL(
      '../../dsh-plugin-gala/assets/gala/officials/stars/assets/portrait-v2.webp',
      import.meta.url,
    ))
    const resolved = splashPresentationFromAppearance({
      kind: 'character',
      appearanceId: 'gala:skin-stars',
      name: 'GALA·群星',
      message: '十位伙伴都到齐了，马上出发',
      accent: '#6758d8',
      background: '#f7f6ff',
      surface: '#eeebff',
      firstRun: true,
      recovered: false,
      artPath,
    })
    expect(resolved.artDataUrl).toMatch(/^data:image\/webp;base64,/u)
    expect(resolved.artDataUrl.length).toBeGreaterThan(10_000)
  })

  it('settle 幂等销毁窗口并清掉超时器', () => {
    vi.useFakeTimers()
    const close = vi.fn()
    const controller = openSplash({ open: () => ({ close }) }, {
      minimumVisibleMs: 0,
      presentation: presentation(),
    })

    controller.settle()
    controller.settle()
    expect(close).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(SPLASH_TIMEOUT_MS + 1000)
    expect(close).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('主窗口很快 ready 时，从窗口真正显示起保证最短可见时间', async () => {
    vi.useFakeTimers()
    const close = vi.fn()
    let markShown!: () => void
    const shown = new Promise<void>(resolve => { markShown = resolve })
    const controller = openSplash({ open: () => ({ close, shown }) }, { presentation: presentation() })

    controller.settle()
    expect(close).not.toHaveBeenCalled()
    vi.advanceTimersByTime(SPLASH_MINIMUM_VISIBLE_MS * 2)
    expect(close).not.toHaveBeenCalled()
    markShown()
    await Promise.resolve()
    vi.advanceTimersByTime(SPLASH_MINIMUM_VISIBLE_MS - 1)
    expect(close).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(close).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('超时自动销毁（主窗迟迟不 ready 的兜底）', () => {
    vi.useFakeTimers()
    const close = vi.fn()
    openSplash({ open: () => ({ close }) }, {
      timeoutMs: 500,
      minimumVisibleMs: 0,
      presentation: presentation(),
    })
    vi.advanceTimersByTime(600)
    expect(close).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('窗口创建失败不抛出（绝不阻塞启动）', () => {
    const controller = openSplash({
      open: () => {
        throw new Error('display not ready')
      },
    }, { presentation: presentation() })
    expect(() => controller.settle()).not.toThrow()
  })
})
