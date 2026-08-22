/**
 * 启动画面 — PRD v4.0 §2.2 步骤 1 / §14.2
 *
 * 无边框透明小窗，显示当前激活嘎啦的软萌立绘 + 呼吸动画，
 * 主窗 ready 或超时后销毁。任何失败只写 stderr，绝不阻塞启动。
 * 立绘用程序化 SVG（gala-avatar），零磁盘依赖，首启即可爱。
 */

import { renderGalaSvg, type GalaCharacter } from 'dsh-plugin-gala'

/** 启动画面窗口尺寸 */
export const SPLASH_WIDTH = 320
export const SPLASH_HEIGHT = 360
/** 主窗迟迟不 ready 时的强制销毁时限 */
export const SPLASH_TIMEOUT_MS = 10_000

/** 内置默认嘎啦（首启没有任何数据时的启动画面主角） */
export const SPLASH_DEFAULT_CHARACTER: Pick<GalaCharacter, 'id' | 'family' | 'rarity'> & { name: string } = {
  id: 'gala:dsh-base',
  name: '阿基',
  family: 'core',
  rarity: 'rare',
}

/** 生成启动画面 HTML（自包含 data URL 加载；无外链无不可信输入） */
export function renderSplashHtml(
  character: Pick<GalaCharacter, 'id' | 'family' | 'rarity'> & { name: string } = SPLASH_DEFAULT_CHARACTER,
): string {
  const svg = renderGalaSvg(character, 'happy')
  const name = character.name.replace(/[<>&"']/g, '')
  return [
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" /><style>',
    'html, body { margin: 0; background: transparent; overflow: hidden; }',
    '.stage { width: 100vw; height: 100vh; display: grid; place-items: center; }',
    '.card {',
    '  display: grid; place-items: center; gap: 4px; padding: 26px 34px 22px;',
    '  background: #fdf6ee; border: 3.5px solid #3a3050; border-radius: 30px;',
    '  box-shadow: 0 8px 0 rgba(58, 48, 80, 0.85);',
    '}',
    '.art { width: 180px; height: 180px; animation: breathe 1.6s ease-in-out infinite; }',
    '.name { font-family: "PingFang SC", "Microsoft YaHei", sans-serif; font-weight: 800; font-size: 18px; color: #3a3050; }',
    '.dots { font-family: sans-serif; font-size: 14px; color: #8d84a3; }',
    '.dots span { animation: blink 1.2s infinite; }',
    '.dots span:nth-child(2) { animation-delay: 0.2s; }',
    '.dots span:nth-child(3) { animation-delay: 0.4s; }',
    '@keyframes breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.05); } }',
    '@keyframes blink { 0%, 100% { opacity: 0.2; } 50% { opacity: 1; } }',
    '@media (prefers-reduced-motion: reduce) { .art, .dots span { animation: none; } }',
    '</style></head><body><div class="stage"><div class="card">',
    `<div class="art">${svg.replace('<svg ', '<svg style="width:100%;height:100%" ')}</div>`,
    `<div class="name">${name}</div>`,
    '<div class="dots">出发中<span>·</span><span>·</span><span>·</span></div>',
    '</div></div></body></html>',
  ].join('')
}

/** 启动画面依赖注入（Electron 窗口由 main.ts 提供，保持本模块可单测） */
export interface SplashWindowHost {
  /** 创建并展示启动窗口，返回销毁函数 */
  open(html: string): () => void
}

/** 启动画面控制器：open 即显示，settle 幂等销毁（ready / 超时 / 失败共用） */
export interface SplashController {
  settle(): void
}

/** 打开启动画面；任何失败退化为 no-op（绝不阻塞启动） */
export function openSplash(
  host: SplashWindowHost,
  timeoutMs: number = SPLASH_TIMEOUT_MS,
): SplashController {
  let close: (() => void) | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    close = host.open(renderSplashHtml())
    timer = setTimeout(() => { settle() }, timeoutMs)
  } catch (cause) {
    process.stderr.write(
      `dsh-plugin-desktop: splash failed to open: ${cause instanceof Error ? cause.message : String(cause)}\n`,
    )
  }
  function settle(): void {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    try {
      close?.()
    } catch {
      // 销毁失败无关紧要
    }
    close = undefined
  }
  return { settle }
}
