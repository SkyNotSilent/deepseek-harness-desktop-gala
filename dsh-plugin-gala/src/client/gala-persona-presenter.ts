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
export const DEFAULT_COMPOSER_PLACEHOLDERS = [
  '给智能体发消息',
  'Message the agent',
  '描述你想要构建的内容',
  'Describe what you want to build',
] as const
export const PERSONA_TAGLINE_CLASS = 'gala-persona-tagline'
export const PERSONA_BACKDROP_CLASS = 'gala-persona-backdrop'
/** 挂到舞台元素上的作用域 class：只有它存在时，可读性样式才生效。 */
export const PERSONA_STAGE_CLASS = 'gala-backdrop-stage'

const PERSONA_STYLE_KEY = 'dsh-plugin-gala/persona-backdrop'

/**
 * 立绘蒙版：色标全部基于 `--dsw-alias-bg-base`（gala 皮肤把 `--gala-color-bg`
 * 映射到它，theme 服务按明暗模式落地），因此自动跟随角色主题色与深浅色模式。
 * 右端保留 38% 不透明度作为可读性下限——把立绘拉进主题明度域，局部对比再由
 * 消息毛玻璃卡兜底。
 */
export function backdropBackgroundImage(backdropUrl: string): string {
  return 'linear-gradient(90deg, '
    + 'color-mix(in srgb, var(--dsw-alias-bg-base) 94%, transparent) 0%, '
    + 'color-mix(in srgb, var(--dsw-alias-bg-base) 72%, transparent) 38%, '
    + 'color-mix(in srgb, var(--dsw-alias-bg-base) 50%, transparent) 64%, '
    + 'color-mix(in srgb, var(--dsw-alias-bg-base) 38%, transparent) 100%), '
    + `url("${backdropUrl.replaceAll('"', '%22')}")`
}

/**
 * 立绘背景下的消息可读性样式。选择器只用自有 stage class 加上游注册常量属性
 * `data-chat-flow-kind`（无构建哈希，可长期依赖）；正向枚举非 user 项，user
 * 气泡自带实色底保持原生。卡底不透明度 78% 是唯一调优旋钮：浅色立绘高光区
 * 若对比不足，优先升到 82–85%，不要动 gala-skin-map 的全局文字对比度目标。
 */
export const PERSONA_READABILITY_CSS = `
.${PERSONA_STAGE_CLASS} [data-chat-flow-kind="assistant-step"],
.${PERSONA_STAGE_CLASS} [data-chat-flow-kind="tool-call"],
.${PERSONA_STAGE_CLASS} [data-chat-flow-kind="context"],
.${PERSONA_STAGE_CLASS} [data-chat-flow-kind="command"],
.${PERSONA_STAGE_CLASS} [data-chat-flow-kind="steering"],
.${PERSONA_STAGE_CLASS} [data-chat-flow-kind="compaction"],
.${PERSONA_STAGE_CLASS} [data-chat-flow-kind="turn-error"] {
  background: color-mix(in srgb, var(--dsw-alias-bg-base) 78%, transparent);
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
  border-radius: 12px;
  padding: 8px 14px;
  margin-inline: -14px;
}
`

/** 幂等注入可读性样式表；规则被 stage class 完全钳制，常驻无副作用。 */
export function ensurePersonaStyles(doc: Document): void {
  if (doc.head.querySelector(`style[data-plugin-css="${PERSONA_STYLE_KEY}"]`) !== null) return
  const style = doc.createElement('style')
  style.dataset.plugin = 'dsh-plugin-gala'
  style.dataset.pluginCss = PERSONA_STYLE_KEY
  style.textContent = PERSONA_READABILITY_CSS
  doc.head.appendChild(style)
}

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

/**
 * 个性化人物开启时，输入框邀请语跟随当前角色；未开启、群星/经典配色或原装都留空。
 * 这里只读取已激活的 persona，不把单纯的外观选择误当成模型人格。
 */
export function parsePickerComposerPlaceholder(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null) return ''
  const picker = (payload as { picker?: unknown }).picker
  if (typeof picker !== 'object' || picker === null) return ''
  const state = picker as { personaEnabled?: unknown, activePersona?: unknown }
  if (state.personaEnabled !== true || typeof state.activePersona !== 'object' || state.activePersona === null) return ''
  const name = (state.activePersona as { name?: unknown }).name
  if (typeof name !== 'string' || name.trim() === '') return ''
  return `想和${name.trim()}说点什么？`
}

/** 只接管上游默认邀请语；计划、离线、排队等状态提示必须继续由上游显示。 */
export function isDefaultComposerPlaceholder(value: string): boolean {
  return DEFAULT_COMPOSER_PLACEHOLDERS.includes(value as typeof DEFAULT_COMPOSER_PLACEHOLDERS[number])
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
  setComposerPlaceholder(value: string): void
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
  let composerPlaceholder = ''
  let observer: MutationObserver | undefined
  let scheduled = false
  const textReplacements: TextReplacement[] = []
  const taglines = new Set<HTMLElement>()
  let backdrop: HTMLElement | undefined
  let stageSnapshot: StageStyleSnapshot | undefined

  const restoreComposerPlaceholders = (): void => {
    for (const textarea of doc.querySelectorAll<HTMLTextAreaElement>('[data-composer-card] textarea')) {
      const applied = textarea.dataset.galaComposerPlaceholder
      const original = textarea.dataset.galaComposerPlaceholderOriginal
      if (applied !== undefined && original !== undefined && (textarea.getAttribute('placeholder') ?? '') === applied) {
        textarea.setAttribute('placeholder', original)
      }
      delete textarea.dataset.galaComposerPlaceholder
      delete textarea.dataset.galaComposerPlaceholderOriginal
    }
  }

  const syncComposerPlaceholders = (): void => {
    for (const textarea of doc.querySelectorAll<HTMLTextAreaElement>('[data-composer-card] textarea')) {
      const currentPlaceholder = textarea.getAttribute('placeholder') ?? ''
      const previousApplied = textarea.dataset.galaComposerPlaceholder
      if (previousApplied !== undefined) {
        if (currentPlaceholder === previousApplied) {
          if (currentPlaceholder !== composerPlaceholder) {
            textarea.setAttribute('placeholder', composerPlaceholder)
            textarea.dataset.galaComposerPlaceholder = composerPlaceholder
          }
          continue
        }
        // React 已切换到计划、离线或排队等特殊状态：立即交还控制权。
        delete textarea.dataset.galaComposerPlaceholder
        delete textarea.dataset.galaComposerPlaceholderOriginal
      }
      if (!isDefaultComposerPlaceholder(currentPlaceholder)) continue
      textarea.dataset.galaComposerPlaceholderOriginal = currentPlaceholder
      textarea.setAttribute('placeholder', composerPlaceholder)
      textarea.dataset.galaComposerPlaceholder = composerPlaceholder
    }
  }

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
      element.classList.remove(PERSONA_STAGE_CLASS)
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
    layer.style.backgroundColor = 'var(--dsw-alias-bg-base)'
    layer.style.backgroundImage = backdropBackgroundImage(persona.backdrop)
    layer.style.backgroundPosition = 'center, right center'
    layer.style.backgroundRepeat = 'no-repeat'
    layer.style.backgroundSize = '100% 100%, cover'
    layer.style.filter = 'saturate(0.86) contrast(0.94)'
    stage.prepend(layer)
    backdrop = layer
    ensurePersonaStyles(doc)
    stage.classList.add(PERSONA_STAGE_CLASS)
  }

  const scan = (): void => {
    scheduled = false
    syncComposerPlaceholders()
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
        element.classList.remove(PERSONA_STAGE_CLASS)
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
    observer.observe(doc.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['placeholder'],
    })
  }

  return {
    apply: persona => {
      restore()
      current = persona
      if (persona === null) return
      scan()
      ensureObserver()
    },
    setComposerPlaceholder: value => {
      composerPlaceholder = value
      scan()
      ensureObserver()
    },
    dispose: () => {
      observer?.disconnect()
      observer = undefined
      current = null
      restore()
      restoreComposerPlaceholders()
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
      const payload: unknown = await response.json()
      const persona = parsePickerPersona(payload)
      const placeholder = parsePickerComposerPlaceholder(payload)
      if (!stopped) {
        presenter.apply(persona)
        presenter.setComposerPlaceholder(placeholder)
      }
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
