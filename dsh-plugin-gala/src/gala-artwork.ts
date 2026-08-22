/**
 * 嘎啦正式立绘生成（生图 API 适配器）— 软萌手绘风
 *
 * 鉴权走环境变量（`GALA_ART_API_KEY`），key 不进仓库、不进 `.ggal` 包。
 * 未配置 key、请求失败、返回非图片时一律回退 `renderGalaSvg` 的程序化形象，
 * 产品在无网/无 key 环境下不降级为坏图。
 *
 * 只由资产生成脚本（scripts/generate-gala-assets.ts）在开发机调用，
 * 运行中的桌面端不请求外网（PRD §7.2：皮肤/资源只加载本地文件）。
 */

import { renderGalaSvg, type GalaExpression } from './gala-avatar.ts'
import type { GalaCharacter } from './protocols/gala-json.ts'

/** 生图 endpoint 环境变量；缺省 Agnes Image */
export const ART_API_URL_ENV = 'GALA_ART_API_URL'
/** 生图 key 环境变量 */
export const ART_API_KEY_ENV = 'GALA_ART_API_KEY'
/** 缺省 endpoint（Agnes Image 2.1 Flash） */
export const DEFAULT_ART_API_URL = 'https://apihub.agnes-ai.com/v1/images/generations'
/** 缺省模型名 */
export const DEFAULT_ART_MODEL = 'agnes-image-2.1-flash'

/** 一次立绘请求的产物 */
export interface GalaArtwork {
  /** 图片字节 */
  data: Buffer
  /** 'png' | 'svg'（svg = 程序化回退） */
  format: 'png' | 'svg'
  /** 来源：api 成功 / fallback 回退 */
  source: 'api' | 'fallback'
}

/** 立绘提供者：给角色与表情，返回图片 */
export interface GalaArtworkProvider {
  generate(character: GalaCharacter, expression: GalaExpression): Promise<GalaArtwork>
}

/** 表情的中文提示词片段 */
const EXPRESSION_PROMPTS: Record<GalaExpression, string> = {
  idle: '温柔微笑看向观众',
  happy: '开心大笑，眯眯眼，元气满满',
  sleepy: '困倦打瞌睡，闭眼，气泡里冒 z',
  surprised: '惊讶睁大眼睛，小嘴微张',
}

/** 族系的角色气质提示词 */
const FAMILY_PROMPTS: Record<string, string> = {
  core: '蜜金色头发，可靠温暖的大姐姐气质',
  mind: '薰衣草紫色头发，聪慧文静的天才少女气质',
  craft: '薄荷绿色头发，元气活泼的工匠少女气质',
  guard: '天蓝色头发，认真正直的骑士少女气质',
  link: '樱花粉色头发，开朗爱笑的少女气质',
  system: '银灰色头发，冷静神秘的少女气质',
}

/** 统一风格提示词（§14.1：所有角色一致的画风/构图规范写进 prompt） */
export function artworkPrompt(character: GalaCharacter, expression: GalaExpression): string {
  const familyPrompt = FAMILY_PROMPTS[character.family] ?? '柔和粉彩色头发的少女'
  // 台词引号里的文字会被模型画进画面（盾牌上写字等），剥掉再入 prompt
  const description = character.description.replace(/「[^」]*」/g, '')
  return [
    `二次元恋爱游戏（galgame）风格的少女角色头像立绘「${character.name}」：`,
    `${familyPrompt}，${EXPRESSION_PROMPTS[expression]}。`,
    `角色设定：${description}`,
    '高质量动漫插画，干净的线稿，大眼睛高光，柔和赛璐璐上色，穿着完整得体的可爱服装，',
    '胸像构图居中，纯白背景。画面中不出现任何文字、字母或符号。',
    'anime bishoujo portrait, gal game character art, clean lineart, big sparkling eyes,',
    'soft cel shading, pastel colors, fully clothed in a cute outfit, bust-up, centered,',
    'white background, absolutely no text or letters anywhere, no watermark',
  ].join(' ')
}

/** 环境配置（generate 时读取；测试注入覆盖） */
export interface ArtworkEnvOptions {
  env?: Record<string, string | undefined>
  fetchImpl?: typeof fetch
  model?: string
  /** 重试等待器；测试可注入即时实现，生产缺省等待 3 秒。 */
  sleep?: (milliseconds: number) => Promise<void>
}

function fallback(character: GalaCharacter, expression: GalaExpression): GalaArtwork {
  return {
    data: Buffer.from(renderGalaSvg(character, expression), 'utf8'),
    format: 'svg',
    source: 'fallback',
  }
}

/** 从 OpenAI 兼容响应里取第一张图（b64_json 或 url 二选一） */
async function extractImage(
  payload: unknown,
  fetchImpl: typeof fetch,
): Promise<Buffer | undefined> {
  if (typeof payload !== 'object' || payload === null) return undefined
  const data = (payload as { data?: unknown }).data
  if (!Array.isArray(data) || data.length === 0) return undefined
  const first = data[0] as { b64_json?: unknown; url?: unknown }
  if (typeof first.b64_json === 'string' && first.b64_json.length > 0) {
    return Buffer.from(first.b64_json, 'base64')
  }
  if (typeof first.url === 'string' && first.url.startsWith('https://')) {
    const response = await fetchImpl(first.url)
    if (!response.ok) return undefined
    return Buffer.from(await response.arrayBuffer())
  }
  return undefined
}

/**
 * 创建环境变量驱动的立绘提供者。
 * key 未配置 → 直接回退；API 出错/超时/返回异常 → 回退并把原因写 stderr。
 */
export function createEnvArtworkProvider(options: ArtworkEnvOptions = {}): GalaArtworkProvider {
  const env = options.env ?? process.env
  const fetchImpl = options.fetchImpl ?? fetch
  const model = options.model ?? DEFAULT_ART_MODEL
  const sleep = options.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)))

  const requestOnce = async (character: GalaCharacter, expression: GalaExpression, apiKey: string): Promise<Buffer> => {
    const endpoint = env[ART_API_URL_ENV] ?? DEFAULT_ART_API_URL
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      // Agnes 网关不支持 size / response_format 参数（返回 URL 形式）
      body: JSON.stringify({
        model,
        prompt: artworkPrompt(character, expression),
        n: 1,
      }),
    })
    if (!response.ok) {
      throw new Error(`API ${String(response.status)}`)
    }
    const image = await extractImage(await response.json(), fetchImpl)
    if (image === undefined || image.byteLength === 0) {
      throw new Error('响应中没有图片数据')
    }
    return image
  }

  return {
    generate: async (character, expression) => {
      const apiKey = env[ART_API_KEY_ENV]
      if (apiKey === undefined || apiKey === '') return fallback(character, expression)

      // 网关偶发限流 / 瞬断：重试一次再回退
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const image = await requestOnce(character, expression, apiKey)
          return { data: image, format: 'png', source: 'api' }
        } catch (cause) {
          process.stderr.write(
            `gala-artwork: ${character.id}/${expression} 第 ${String(attempt + 1)} 次生图失败: `
              + `${cause instanceof Error ? cause.message : String(cause)}\n`,
          )
          if (attempt === 0) await sleep(3000)
        }
      }
      return fallback(character, expression)
    },
  }
}
