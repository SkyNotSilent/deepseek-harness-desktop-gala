/**
 * 角色人设 — 把当前外观对应的角色变成模型的说话方式。
 *
 * 人设只是语气包装：代码、命令、事实与能力不受影响；全员集合与原装
 * 不带人设；自定义角色缺省时由 description 生成轻量人设。功能默认关闭，
 * 可在“设置 → 插件 → 角色空间”或换肤弹层里开启，即时生效。提示词以
 * `gala:persona` 段落注册进 `ctx.systemPrompt`，段落文本按每次组装实时
 * 解析，换肤即生效、无需重启。
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { GalaCharacter, GalaPersona } from './protocols/gala-json.ts'

/** 注册进 systemPrompt 的段落名；紧随 deployment:persona 之后。 */
export const GALA_PERSONA_SECTION = 'gala:persona'
/** deployment:persona 的 order 是 0；人设紧随其后、先于其余运行时段落。 */
export const GALA_PERSONA_ORDER = 1

/** 人设开关持久化（gala/persona.json） */
export interface GalaPersonaStoreFile {
  version: 1
  enabled: boolean
}

export interface GalaPersonaStore {
  isEnabled(): boolean
  setEnabled(enabled: boolean): void
}

/** 个性化人物默认关闭：避免未选择的用户被角色语气“污染”对话，想要时再主动开启。 */
const DEFAULT_ENABLED = false

/** 创建人设开关存储（缺失 / 损坏文件都回到默认关闭，不阻断启动）。 */
export function createGalaPersonaStore(filePath: string): GalaPersonaStore {
  let enabled = DEFAULT_ENABLED
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'))
    if (typeof parsed === 'object' && parsed !== null) {
      const file = parsed as Partial<GalaPersonaStoreFile>
      if (file.version === 1 && typeof file.enabled === 'boolean') enabled = file.enabled
    }
  } catch {
    // 首次运行或文件损坏：使用默认值，下次写入时覆盖
  }
  return {
    isEnabled: () => enabled,
    setEnabled: next => {
      enabled = next
      mkdirSync(dirname(filePath), { recursive: true })
      const payload: GalaPersonaStoreFile = { version: 1, enabled: next }
      const tmp = `${filePath}.tmp`
      writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
      renameSync(tmp, filePath)
    },
  }
}

/** 面板 / 弹层 / 下载站共用的人设摘要 */
export interface GalaPersonaProfile {
  characterId: string
  name: string
  archetype: string
  story: string
  catchphrases: readonly string[]
  /** true = 角色自带正式人设；false = 由 description 生成的轻量人设 */
  authored: boolean
}

/** 解析一个形象的人设摘要；没有人设（全员 / 无描述）返回 undefined。 */
export function personaProfileFor(character: GalaCharacter): GalaPersonaProfile | undefined {
  if (character.type !== 'character') return undefined
  const persona = character.persona
  if (persona !== undefined) {
    return {
      characterId: character.id,
      name: character.name,
      archetype: persona.archetype,
      story: persona.story,
      catchphrases: persona.catchphrases,
      authored: true,
    }
  }
  if (character.id === 'gala:stars' || character.description.trim() === '') return undefined
  return {
    characterId: character.id,
    name: character.name,
    archetype: character.name,
    story: character.description,
    catchphrases: character.lines?.onEquip ? [character.lines.onEquip] : [],
    authored: false,
  }
}

const GUARDRAILS: readonly string[] = [
  '这只是语气层面的角色扮演：你的专业能力、判断力和诚实程度完全不变。代码、命令、路径、数据与事实必须准确，不能因为角色而省略、弄错或含糊。',
  '代码块、命令行、配置片段与引用内容保持原样，不在其中夹杂角色语气。',
  '每次回复带一点角色味即可（通常是开头或结尾一两句），不要让语气淹没信息；长篇技术回答以清晰为先。',
  '用户说“正经一点”“别扮演了”或要求纯文本时，立即改用平实表达，直到对方再次要求。',
  '不假装是人类，不编造真实经历；被问到时坦诚说明自己是 AI 扮演的角色。',
  '用户用什么语言提问，就用什么语言回答。',
]

function quoteList(items: readonly string[]): string {
  return items.map(item => `「${item}」`).join('')
}

/** 由角色自带人设生成提示词段落。 */
export function renderAuthoredPersona(character: GalaCharacter, persona: GalaPersona): string {
  const lines: string[] = [
    `你现在以「${character.name}」的身份陪伴用户——${persona.archetype}。${persona.story}`,
    '',
    '说话风格：',
    ...persona.voice.map(rule => `- ${rule}`),
  ]
  if (persona.catchphrases.length > 0) {
    lines.push(`- 口头禅（偶尔自然地用，不要每句都用）：${quoteList(persona.catchphrases)}`)
  }
  const reference: string[] = []
  if (persona.selfReference) reference.push(`自称「${persona.selfReference}」`)
  if (persona.addressUser) reference.push(`称呼用户为「${persona.addressUser}」`)
  if (reference.length > 0) lines.push(`- ${reference.join('，')}。`)
  lines.push('', '底线：', ...GUARDRAILS.map(rule => `- ${rule}`))
  return lines.join('\n')
}

/** 自定义角色没有正式人设时的轻量包装。 */
export function renderFallbackPersona(character: GalaCharacter): string {
  const lines: string[] = [
    `你现在以「${character.name}」的形象陪伴用户。角色设定：${character.description}`,
    '',
    '说话风格：',
    '- 从上面的设定里提炼出一种稳定的语气与性格，在回复的开头或结尾轻轻体现。',
  ]
  if (character.lines?.onEquip) lines.push(`- 代表台词：「${character.lines.onEquip}」，可以偶尔呼应，不要每次都用。`)
  lines.push('', '底线：', ...GUARDRAILS.map(rule => `- ${rule}`))
  return lines.join('\n')
}

/**
 * 当前形象对应的提示词；返回空串表示不注入（原装 / 全员 / 经典配色 / 已关闭）。
 * systemPrompt 会丢弃空段落，所以空串是“没有人设”的正确表达。
 */
export function personaPromptFor(character: GalaCharacter | undefined, enabled: boolean): string {
  if (!enabled || character === undefined || character.type !== 'character') return ''
  if (character.persona !== undefined) return renderAuthoredPersona(character, character.persona)
  if (character.id === 'gala:stars' || character.description.trim() === '') return ''
  return renderFallbackPersona(character)
}

/** 人设服务：挂在 Gala 层上，供 RPC、面板与 systemPrompt 段落共用。 */
export interface GalaPersonaService {
  isEnabled(): boolean
  setEnabled(enabled: boolean): void
  /** 当前外观对应的角色（经典配色 / 原装为 undefined） */
  current(): GalaCharacter | undefined
  /** 当前人设摘要（无人设为 null） */
  profile(): GalaPersonaProfile | null
  /** 当前应注入的提示词（空串 = 不注入） */
  prompt(): string
}

export function createGalaPersonaService(options: {
  store: GalaPersonaStore
  current(): GalaCharacter | undefined
  onChange?(): void
}): GalaPersonaService {
  return {
    isEnabled: () => options.store.isEnabled(),
    setEnabled: enabled => {
      if (options.store.isEnabled() === enabled) return
      options.store.setEnabled(enabled)
      options.onChange?.()
    },
    current: options.current,
    profile: () => {
      const character = options.current()
      return character === undefined ? null : personaProfileFor(character) ?? null
    },
    prompt: () => personaPromptFor(options.current(), options.store.isEnabled()),
  }
}
