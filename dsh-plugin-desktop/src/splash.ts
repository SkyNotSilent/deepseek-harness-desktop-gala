/** Launch window that mirrors the persisted Gala appearance selected for this startup. */

import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import type { GalaSplashAppearance } from 'dsh-plugin-gala'

/** Launch window dimensions. */
export const SPLASH_WIDTH = 448
export const SPLASH_HEIGHT = 280
/** Hard stop when the main window never becomes ready. */
export const SPLASH_TIMEOUT_MS = 10_000
/** Keep a successful cold-start launch card visible long enough to be perceived. */
export const SPLASH_MINIMUM_VISIBLE_MS = 1_800

export interface SplashPresentation {
  readonly kind: GalaSplashAppearance['kind']
  readonly name: string
  readonly message: string
  readonly accent: string
  readonly background: string
  readonly surface: string
  readonly firstRun: boolean
  readonly recovered: boolean
  readonly artDataUrl: string
}

const FALLBACK_ART = `data:image/svg+xml;base64,${Buffer.from([
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160">',
  '<rect width="160" height="160" rx="38" fill="#25204a"/>',
  '<path d="M80 71C68 42 40 23 10 23c-8 0-10 19-2 33 9 16 27 25 47 25L80 71Zm0 0c12-29 40-48 70-48 8 0 10 19 2 33-9 16-27 25-47 25L80 71Zm0 18c-12 28-38 47-68 47-8 0-10-18-2-32 9-15 26-24 46-24L80 89Zm0 0c12 28 38 47 68 47 8 0 10-18 2-32-9-15-26-24-46-24L80 89Z" fill="#fff" opacity=".95"/>',
  '<circle cx="80" cy="80" r="17" fill="#70d7ff"/>',
  '</svg>',
].join('')).toString('base64')}`

const DEFAULT_PRESENTATION: SplashPresentation = {
  kind: 'character',
  name: 'GALA·群星',
  message: '十位伙伴都到齐了，马上出发',
  accent: '#6758d8',
  background: '#f7f6ff',
  surface: '#eeebff',
  firstRun: true,
  recovered: false,
  artDataUrl: FALLBACK_ART,
}

function imageMime(filename: string): string | undefined {
  switch (extname(filename).toLowerCase()) {
    case '.png': return 'image/png'
    case '.webp': return 'image/webp'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.gif': return 'image/gif'
    case '.svg': return 'image/svg+xml'
    default: return undefined
  }
}

/** Load only a trusted local Gala asset into the self-contained data document. */
export function splashPresentationFromAppearance(appearance: GalaSplashAppearance): SplashPresentation {
  let artDataUrl = FALLBACK_ART
  const mime = imageMime(appearance.artPath)
  if (mime !== undefined) {
    try {
      artDataUrl = `data:${mime};base64,${readFileSync(appearance.artPath).toString('base64')}`
    } catch {
      // Optional art must never turn into an application startup failure.
    }
  }
  return {
    kind: appearance.kind,
    name: appearance.name,
    message: appearance.message,
    accent: appearance.accent,
    background: appearance.background,
    surface: appearance.surface,
    firstRun: appearance.firstRun,
    recovered: appearance.recovered,
    artDataUrl,
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[character]!)
}

function safeColor(value: string, fallback: string): string {
  return /^#[0-9a-f]{6}$/iu.test(value) ? value : fallback
}

function safeArt(value: string): string {
  return /^data:image\/(?:png|webp|jpeg|gif|svg\+xml);base64,[a-z0-9+/=]+$/iu.test(value)
    ? value
    : FALLBACK_ART
}

/** Render a self-contained, selected-IP launch card. */
export function renderSplashHtml(
  presentation: SplashPresentation = DEFAULT_PRESENTATION,
): string {
  const name = escapeHtml(presentation.name)
  const message = escapeHtml(presentation.message)
  const accent = safeColor(presentation.accent, DEFAULT_PRESENTATION.accent)
  const background = safeColor(presentation.background, DEFAULT_PRESENTATION.background)
  const surface = safeColor(presentation.surface, DEFAULT_PRESENTATION.surface)
  const art = safeArt(presentation.artDataUrl)
  const state = presentation.firstRun ? '初次见面' : presentation.recovered ? '安全恢复' : '欢迎回来'
  return [
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" />',
    '<meta name="color-scheme" content="light" /><style>',
    '* { box-sizing: border-box; }',
    'html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }',
    'body { font-family: "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; color: #25203d; }',
    `.stage { --accent: ${accent}; --background: ${background}; --surface: ${surface}; width: 100%; height: 100%; padding: 14px; display: grid; place-items: center; }`,
    '.card { position: relative; width: 420px; height: 250px; overflow: hidden; border-radius: 32px;',
    '  background: linear-gradient(128deg, var(--background) 0%, var(--surface) 58%, #fff 100%);',
    '  border: 1px solid rgba(255,255,255,.92); box-shadow: 0 22px 55px rgba(32,26,67,.22), 0 2px 10px rgba(32,26,67,.12);',
    '  animation: arrive .42s cubic-bezier(.2,.8,.2,1) both; }',
    '.wash { position: absolute; inset: -28px -18px -28px 148px; width: 300px; height: 300px; object-fit: cover;',
    '  opacity: .18; filter: blur(16px) saturate(1.25); transform: scale(1.12); }',
    '.glow { position: absolute; width: 220px; height: 220px; right: -58px; top: -72px; border-radius: 50%;',
    '  background: var(--accent); opacity: .13; filter: blur(5px); }',
    '.brand { position: absolute; left: 28px; top: 23px; display: flex; align-items: center; gap: 8px;',
    '  font-size: 10px; line-height: 1; letter-spacing: .18em; font-weight: 800; color: rgba(37,32,61,.62); }',
    '.brand-mark { width: 8px; height: 8px; border-radius: 3px; background: var(--accent); transform: rotate(45deg); box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 13%, transparent); }',
    '.content { position: absolute; inset: 58px 25px 23px 27px; display: grid; grid-template-columns: 132px 1fr; gap: 23px; align-items: center; }',
    '.portrait { position: relative; width: 132px; height: 132px; border-radius: 31px; padding: 5px;',
    '  background: rgba(255,255,255,.78); border: 1px solid rgba(255,255,255,.96); box-shadow: 0 14px 28px color-mix(in srgb, var(--accent) 25%, transparent);',
    '  animation: breathe 2.4s ease-in-out infinite; }',
    '.portrait::after { content: ""; position: absolute; inset: -5px; border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent); border-radius: 36px; pointer-events: none; }',
    '.portrait img { display: block; width: 100%; height: 100%; border-radius: 26px; object-fit: cover; }',
    '.copy { min-width: 0; padding-top: 4px; }',
    '.state { margin: 0 0 7px; color: var(--accent); font-size: 11px; letter-spacing: .14em; font-weight: 800; }',
    'h1 { margin: 0; font-size: 27px; line-height: 1.2; letter-spacing: -.02em; font-weight: 850; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    '.message { margin: 8px 0 20px; min-height: 20px; color: rgba(37,32,61,.62); font-size: 12px; line-height: 1.6; }',
    '.track { width: 100%; height: 4px; overflow: hidden; border-radius: 9px; background: color-mix(in srgb, var(--accent) 13%, white); }',
    '.track i { display: block; width: 42%; height: 100%; border-radius: inherit; background: var(--accent); animation: travel 1.35s ease-in-out infinite; }',
    '@keyframes arrive { from { opacity: 0; transform: translateY(8px) scale(.98); } to { opacity: 1; transform: none; } }',
    '@keyframes breathe { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }',
    '@keyframes travel { 0% { transform: translateX(-110%); } 100% { transform: translateX(340%); } }',
    '@media (prefers-reduced-motion: reduce) { .card, .portrait, .track i { animation: none; } .track i { width: 68%; } }',
    '</style></head><body>',
    `<main class="stage" data-kind="${presentation.kind}"><section class="card">`,
    `<img class="wash" alt="" src="${art}" /><div class="glow"></div>`,
    '<div class="brand"><span class="brand-mark"></span>DEEPSEEK HARNESS · GALA</div>',
    '<div class="content">',
    `<div class="portrait"><img alt="${name}" src="${art}" /></div>`,
    `<div class="copy"><p class="state">${state}</p><h1>${name}</h1><p class="message">${message}</p><div class="track"><i></i></div></div>`,
    '</div></section></main></body></html>',
  ].join('')
}

/** Electron window dependency kept injectable for unit tests. */
export interface SplashWindowHost {
  open(html: string): {
    close(): void
    /** Resolves only after the fully painted window has actually been shown. */
    shown?: Promise<void>
  }
}

export interface SplashController {
  settle(): void
}

export interface OpenSplashOptions {
  readonly timeoutMs?: number
  readonly minimumVisibleMs?: number
  readonly presentation?: SplashPresentation
}

/** Open the launch window; every failure degrades to a no-op. */
export function openSplash(
  host: SplashWindowHost,
  options: OpenSplashOptions = {},
): SplashController {
  let handle: ReturnType<SplashWindowHost['open']> | undefined
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined
  let minimumTimer: ReturnType<typeof setTimeout> | undefined
  let settleRequested = false
  let shownAt: number | undefined
  try {
    handle = host.open(renderSplashHtml(options.presentation))
    timeoutTimer = setTimeout(closeWindow, options.timeoutMs ?? SPLASH_TIMEOUT_MS)
    if (handle.shown === undefined) {
      shownAt = Date.now()
    } else {
      void handle.shown.then(() => {
        shownAt = Date.now()
        scheduleClose()
      }, () => {
        closeWindow()
      })
    }
  } catch (cause) {
    process.stderr.write(
      `dsh-plugin-desktop: splash failed to open: ${cause instanceof Error ? cause.message : String(cause)}\n`,
    )
  }
  function closeWindow(): void {
    if (minimumTimer !== undefined) clearTimeout(minimumTimer)
    minimumTimer = undefined
    if (timeoutTimer !== undefined) clearTimeout(timeoutTimer)
    timeoutTimer = undefined
    try {
      handle?.close()
    } catch {
      // Window destruction is best effort and must not affect startup.
    }
    handle = undefined
  }
  function scheduleClose(): void {
    if (!settleRequested || handle === undefined || shownAt === undefined) return
    const minimumVisibleMs = Math.max(0, options.minimumVisibleMs ?? SPLASH_MINIMUM_VISIBLE_MS)
    const remaining = minimumVisibleMs - (Date.now() - shownAt)
    if (remaining > 0) {
      minimumTimer = setTimeout(closeWindow, remaining)
      return
    }
    closeWindow()
  }
  function settle(): void {
    if (settleRequested) return
    settleRequested = true
    scheduleClose()
  }
  return { settle }
}
