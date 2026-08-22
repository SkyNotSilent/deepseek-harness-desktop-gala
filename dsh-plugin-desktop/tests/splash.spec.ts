import { describe, expect, it, vi } from 'vitest'
import { openSplash, renderSplashHtml, SPLASH_TIMEOUT_MS } from '../src/splash.ts'

describe('启动画面', () => {
  it('HTML 自包含：内嵌 SVG 立绘、无外链、带呼吸动画与降噪回退', () => {
    const html = renderSplashHtml()
    expect(html).toContain('<svg')
    expect(html).toContain('阿基')
    expect(html).toContain('breathe')
    expect(html).toContain('prefers-reduced-motion')
    // xmlns 命名空间是唯一允许的 http 出现
    expect(html.replaceAll('http://www.w3.org/2000/svg', '')).not.toMatch(/https?:/)
  })

  it('角色名中的标记字符被剥离', () => {
    const html = renderSplashHtml({ id: 'gala:x-test', family: 'core', rarity: 'common', name: '<b>凶"名\'</b>' })
    expect(html).toContain('b凶名/b') // 尖括号引号剥离，纯文本残留
    expect(html).not.toContain('<b>')
  })

  it('settle 幂等销毁窗口并清掉超时器', () => {
    vi.useFakeTimers()
    const close = vi.fn()
    const controller = openSplash({ open: () => close })

    controller.settle()
    controller.settle()
    expect(close).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(SPLASH_TIMEOUT_MS + 1000)
    expect(close).toHaveBeenCalledTimes(1) // 超时器已清，不再触发
    vi.useRealTimers()
  })

  it('超时自动销毁（主窗迟迟不 ready 的兜底）', () => {
    vi.useFakeTimers()
    const close = vi.fn()
    openSplash({ open: () => close }, 500)
    vi.advanceTimersByTime(600)
    expect(close).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('窗口创建失败不抛出（绝不阻塞启动）', () => {
    const controller = openSplash({
      open: () => {
        throw new Error('display not ready')
      },
    })
    expect(() => controller.settle()).not.toThrow()
  })
})
