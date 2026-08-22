/**
 * 角色主舞台呈现：穿上角色皮肤时，将欢迎标题、预览徽标与主背景一起换成角色叙事。
 *
 * 这里不依赖上游的哈希 class。文字用产品文案指纹定位，场景层挂在欢迎标题所在的
 * 右侧主内容区；上游在空白页和对话页之间重建节点后 MutationObserver 会重新接上，
 * 切回经典配色则完整还原。
 */

import { GALA_EVENTS_PATH, GALA_PICKER_PATH } from './gala-paths.ts'

export const DEFAULT_WELCOME_HEADLINE = '探索未至之境'
export const DEFAULT_PREVIEW_LABEL = '预览版'
export const WELCOME_HEADLINE_FINGERPRINTS = [DEFAULT_WELCOME_HEADLINE, 'Into the Unknown'] as const
export const PREVIEW_LABEL_FINGERPRINTS = [DEFAULT_PREVIEW_LABEL, 'Preview'] as const
export const PERSONA_TAGLINE_CLASS = 'gala-persona-tagline'
export const PERSONA_BACKDROP_CLASS = 'gala-persona-backdrop'

export interface GalaPersonaInfo {
  characterId: string
  name: string
  headline: string
  tagline: string
  backdrop: string | null
}

function isSafeAsset(value: string): boolean {
  return value.startsWith('/') || value.startsWith('data:image/')
}

/** 解析 GET /picker 的角色欢迎页信息；经典配色和不合规载荷都返回 null。 */
export function parsePickerPersona(payload: unknown): GalaPersonaInfo | null {
  if (typeof payload !== 'object' || payload === null) return null
  const picker = (payload as { picker?: unknown }).picker
  if (typeof picker !== 'object' || picker === null) return null
  const persona = (picker as { persona?: unknown }).persona
  if (typeof persona !== 'object' || persona === null) return null
  const { characterId, name, headline, tagline, backdrop } = persona as Record<string, unknown>
  if (
    typeof characterId !== 'string' || typeof name !== 'string' ||
    typeof headline !== 'string' || typeof tagline !== 'string' ||
    (backdrop !== null && (typeof backdrop !== 'string' || !isSafeAsset(backdrop)))
  ) return null
  return { characterId, name, headline, tagline, backdrop: backdrop as string | null }
}

interface TextReplacement {
  element: HTMLElement
  original: string
}

interface StageStyleSnapshot {
  element: HTMLElement
  position: string
  isolation: string
  zIndex: string
}

export interface GalaPersonaPresenter {
  apply(persona: GalaPersonaInfo | null): void
  dispose(): void
}

/** 找到文字完全匹配、且没有重复匹配子元素的最内层节点。 */
function findExactText(doc: Document, expected: readonly string[]): HTMLElement | undefined {
  const candidates = doc.querySelectorAll<HTMLElement>('h1,h2,h3,p,span,div')
  for (const candidate of candidates) {
    const text = candidate.textContent?.trim()
    if (text === undefined || !expected.includes(text)) continue
    const nestedMatch = Array.from(candidate.children).some(child => expected.includes(child.textContent?.trim() ?? ''))
    if (!nestedMatch) return candidate
  }
  return undefined
}

function hasOpaqueBackground(element: HTMLElement, view: Window): boolean {
  const color = view.getComputedStyle(element).backgroundColor.replaceAll(' ', '')
  return color !== 'transparent' && color !== 'rgba(0,0,0,0)'
}

/**
 * 找到右侧整片会话舞台，而不是只包住欢迎标题和输入框的 composer 卡片。
 * Advanced 模式优先使用 Desktop 自有稳定类；兼容模式用几何尺寸和实色背景识别，
 * 避免依赖上游构建生成的哈希 class。
 */
function conversationStageFor(doc: Document, anchor?: HTMLElement): HTMLElement | null {
  const advancedStage = doc.querySelector<HTMLElement>('.dshDesktopConversationSurface')
  if (advancedStage !== null) return advancedStage

  const view = doc.defaultView
  if (view === null) return null
  const minimumWidth = Math.max(560, view.innerWidth * 0.5)
  const minimumHeight = view.innerHeight * 0.75
  const isStage = (element: HTMLElement): boolean => {
    const rect = element.getBoundingClientRect()
    return rect.left > 16
      && rect.width >= minimumWidth
      && rect.height >= minimumHeight
      && rect.right >= view.innerWidth * 0.72
      && hasOpaqueBackground(element, view)
  }

  let current = anchor?.parentElement
  for (let depth = 0; current !== undefined && current !== null && depth < 14; depth += 1) {
    if (isStage(current)) return current
    current = current.parentElement
  }

  const candidates = Array.from(doc.body.querySelectorAll<HTMLElement>('main,section,div')).filter(isStage)
  candidates.sort((left, right) => {
    const leftRect = left.getBoundingClientRect()
    const rightRect = right.getBoundingClientRect()
    // 右侧主区通常比整页 frame 更靠右；同起点时优先更大的稳定外层。
    return rightRect.left - leftRect.left || rightRect.width * rightRect.height - leftRect.width * leftRect.height
  })
  return candidates[0] ?? null
}

/** 创建一个可反复 apply / 完整 dispose 的 DOM 呈现器。 */
export function createGalaPersonaPresenter(doc: Document): GalaPersonaPresenter {
  let current: GalaPersonaInfo | null = null
  let observer: MutationObserver | undefined
  let scheduled = false
  const textReplacements: TextReplacement[] = []
  const taglines = new Set<HTMLElement>()
  let backdrop: HTMLElement | undefined
  let stageSnapshot: StageStyleSnapshot | undefined

  const restore = (): void => {
    for (const replacement of textReplacements) {
      if (replacement.element.isConnected) replacement.element.textContent = replacement.original
    }
    textReplacements.length = 0
    for (const tagline of taglines) tagline.remove()
    taglines.clear()
    backdrop?.remove()
    backdrop = undefined
    if (stageSnapshot !== undefined) {
      const { element, position, isolation, zIndex } = stageSnapshot
      element.style.position = position
      element.style.isolation = isolation
      element.style.zIndex = zIndex
      stageSnapshot = undefined
    }
  }

  const replaceText = (element: HTMLElement, next: string): void => {
    if (textReplacements.some(item => item.element === element)) return
    textReplacements.push({ element, original: element.textContent ?? '' })
    element.textContent = next
  }

  const attachBackdrop = (persona: GalaPersonaInfo, anchor?: HTMLElement): void => {
    if (persona.backdrop === null || backdrop?.isConnected === true) return
    const stage = conversationStageFor(doc, anchor)
    if (stage === null) return
    stageSnapshot = {
      element: stage,
      position: stage.style.position,
      isolation: stage.style.isolation,
      zIndex: stage.style.zIndex,
    }
    const view = doc.defaultView
    if (view !== null && view.getComputedStyle(stage).position === 'static') stage.style.position = 'relative'
    stage.style.isolation = 'isolate'
    stage.style.zIndex = '0'

    const layer = doc.createElement('div')
    layer.className = PERSONA_BACKDROP_CLASS
    layer.setAttribute('aria-hidden', 'true')
    layer.style.position = 'absolute'
    layer.style.inset = '0'
    layer.style.zIndex = '-1'
    layer.style.pointerEvents = 'none'
    layer.style.backgroundColor = '#eee8ff'
    layer.style.backgroundImage = `linear-gradient(90deg, rgba(250,248,255,.86) 0%, rgba(247,241,255,.64) 38%, rgba(229,216,255,.34) 64%, rgba(71,45,127,.12) 100%), url("${persona.backdrop.replaceAll('"', '%22')}")`
    layer.style.backgroundPosition = 'center, right center'
    layer.style.backgroundRepeat = 'no-repeat'
    layer.style.backgroundSize = '100% 100%, cover'
    layer.style.filter = 'saturate(0.86) contrast(0.94)'
    stage.prepend(layer)
    backdrop = layer
  }

  const scan = (): void => {
    scheduled = false
    if (current === null) return
    const headline = findExactText(doc, WELCOME_HEADLINE_FINGERPRINTS)
    attachBackdrop(current, headline)
    if (headline !== undefined) {
      replaceText(headline, current.headline)
      if (!Array.from(taglines).some(item => item.isConnected)) {
        const tagline = doc.createElement('p')
        tagline.className = PERSONA_TAGLINE_CLASS
        tagline.textContent = current.tagline
        tagline.style.margin = '2px auto 10px'
        tagline.style.maxWidth = '34rem'
        tagline.style.fontSize = '14px'
        tagline.style.lineHeight = '1.65'
        tagline.style.letterSpacing = '0.02em'
        tagline.style.opacity = '0.72'
        tagline.style.textAlign = 'center'
        tagline.style.alignSelf = 'center'
        // 标题行是横向 flex；寄语必须作为 stack 的下一行，不能塞进标题行。
        const headlineRow = headline.parentElement ?? headline
        headlineRow.after(tagline)
        taglines.add(tagline)
      }
    }
    const preview = findExactText(doc, PREVIEW_LABEL_FINGERPRINTS)
    if (preview !== undefined) replaceText(preview, current.name)

    for (let index = textReplacements.length - 1; index >= 0; index -= 1) {
      if (!textReplacements[index]!.element.isConnected) textReplacements.splice(index, 1)
    }
    for (const tagline of taglines) if (!tagline.isConnected) taglines.delete(tagline)
    if (backdrop !== undefined && !backdrop.isConnected) {
      backdrop = undefined
      if (stageSnapshot?.element.isConnected === true) {
        const { element, position, isolation, zIndex } = stageSnapshot
        element.style.position = position
        element.style.isolation = isolation
        element.style.zIndex = zIndex
      }
      stageSnapshot = undefined
      // 会话切换会重建右侧主区；在同一次扫描里直接挂回新舞台。
      attachBackdrop(current, headline)
    }
  }

  const scheduleScan = (): void => {
    if (scheduled) return
    scheduled = true
    queueMicrotask(scan)
  }

  const ensureObserver = (): void => {
    if (observer !== undefined || typeof MutationObserver === 'undefined') return
    observer = new MutationObserver(scheduleScan)
    observer.observe(doc.body, { childList: true, subtree: true })
  }

  return {
    apply: persona => {
      restore()
      current = persona
      if (persona === null) return
      scan()
      ensureObserver()
    },
    dispose: () => {
      observer?.disconnect()
      observer = undefined
      current = null
      restore()
    },
  }
}

export interface PersonaPresenterIo {
  fetchImpl?: typeof fetch
  eventSource?: (url: string) => {
    close(): void
    addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
  }
  presenter?: GalaPersonaPresenter
}

/** 启动角色主舞台同步：启动读取一次，收到 skin-changed 后刷新。 */
export function startGalaPersonaPresenter(io: PersonaPresenterIo = {}): () => void {
  const fetchImpl = io.fetchImpl ?? fetch.bind(globalThis)
  const presenter = io.presenter ?? createGalaPersonaPresenter(document)
  let stopped = false

  const refresh = async (): Promise<void> => {
    try {
      const response = await fetchImpl(GALA_PICKER_PATH, { cache: 'no-store' })
      if (!response.ok) return
      const persona = parsePickerPersona(await response.json())
      if (!stopped) presenter.apply(persona)
    } catch {
      // Gala 不可用时不影响主界面。
    }
  }

  void refresh()
  let source: ReturnType<NonNullable<PersonaPresenterIo['eventSource']>> | undefined
  try {
    source = (io.eventSource ?? ((url: string) => new EventSource(url)))(GALA_EVENTS_PATH)
    source.addEventListener('message', event => {
      if (event.data === 'skin-changed') void refresh()
    })
  } catch {
    // SSE 不可用时保留启动时的一次同步。
  }

  return () => {
    stopped = true
    source?.close()
    presenter.dispose()
  }
}
