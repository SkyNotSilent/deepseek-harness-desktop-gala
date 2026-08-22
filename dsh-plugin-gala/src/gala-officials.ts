/**
 * 官方嘎啦全家桶目录 — PRD v4.0 §2.3「插件即角色」/ §8
 *
 * 每只官方嘎啦对应一个真实的上游插件包（都在本包 dependencies 里，
 * 随 dsh-base 束一起装载）。目录是单一事实源：注册中心播种、
 * 头像资产生成脚本、`characterForPackage` 的官方 override 都从这里取。
 *
 * 族系按能力域划分：core 基座 / mind 心智 / craft 工艺 / guard 守护 / link 联结。
 */

import type { GalaCharacter } from './protocols/gala-json.ts'
import type { ComposeRecipe } from './protocols/compose-protocol.ts'

/** 一条官方嘎啦记录：角色元数据 + 它化身的 npm 包 */
export interface OfficialGala {
  /** 对应的上游插件包名 */
  packageName: string
  character: GalaCharacter
  /** 穿上角色皮肤后，欢迎页随角色一起变化的叙事内容 */
  presentation: {
    headline: string
    tagline: string
    backdrop: string
  }
}

const AVATAR = 'assets/portrait-v2.webp'
const EXPRESSIONS = { idle: 'assets/idle.png', happy: 'assets/happy.png', confused: 'assets/confused.png' }

function official(
  packageName: string,
  character: Omit<GalaCharacter, 'assets' | 'expressions' | 'author' | 'version' | 'type'>,
  presentation: OfficialGala['presentation'],
): OfficialGala {
  return {
    packageName,
    presentation,
    character: {
      ...character,
      type: 'character',
      assets: { avatar: AVATAR },
      expressions: EXPRESSIONS,
      author: 'gala-official',
      version: '1.0.0',
    },
  }
}

/** 官方嘎啦全家桶（id 与 §8.4 缺省规则对包名的推导一致） */
export const OFFICIAL_GALAS: readonly OfficialGala[] = [
  official('@deepseek-ai/dsh-base', {
    id: 'gala:dsh-base',
    name: '阿基',
    family: 'core',
    rarity: 'rare',
    tier: 1,
    description: '基石少女。全体插件的可靠大姐姐，谁的地基不稳她都第一个冲过去扶住。',
    lines: { onEquip: '交给我吧，稳稳的哦。' },
    tags: ['基座', '官方'],
  }, {
    headline: '稳住每一层',
    tagline: '地基交给我，你只管把想法往上盖。',
    backdrop: 'assets/hero-v2.webp',
  }),
  official('@deepseek-ai/dsh-web-app', {
    id: 'gala:dsh-web-app',
    name: '小窗',
    family: 'core',
    rarity: 'rare',
    tier: 1,
    description: '看板娘。你看到的每一个界面，都是她擦得亮晶晶的橱窗，欢迎光临！',
    lines: { onEquip: '橱窗擦好啦，请进请进！' },
    tags: ['界面', '官方'],
  }, {
    headline: '让灵感有窗',
    tagline: '每一个界面，都该替你的想法让开视野。',
    backdrop: 'assets/hero-v2.webp',
  }),
  official('@deepseek-ai/dsh-agent', {
    id: 'gala:dsh-agent',
    name: '阿念',
    family: 'mind',
    rarity: 'epic',
    tier: 2,
    description: '天才少女。想事情的时候会咬着笔头转圈圈，然后突然眼睛一亮说「有了！」。',
    lines: { onEquip: '让我想想……有了！' },
    tags: ['智能体', '官方'],
  }, {
    headline: '想法开始行动',
    tagline: '让我多想一步，把模糊的念头变成路径。',
    backdrop: 'assets/hero-v2.webp',
  }),
  official('@deepseek-ai/dsh-llm', {
    id: 'gala:dsh-llm',
    name: '灵灵',
    family: 'mind',
    rarity: 'legendary',
    tier: 3,
    description: '星海巫女。据说她的长发里藏着一整片语言的星海，说话时会漏出来几颗星星。',
    lines: { onEquip: '星星掉出来一颗，替我接住哦。' },
    tags: ['模型', '官方'],
  }, {
    headline: '与星海对话',
    tagline: '语言会落成星光，照亮还没有名字的答案。',
    backdrop: 'assets/hero-v2.webp',
  }),
  official('@deepseek-ai/dsh-sandbox', {
    id: 'gala:dsh-sandbox',
    name: '盾盾',
    family: 'guard',
    rarity: 'rare',
    tier: 1,
    description: '骑士少女。抱着比自己还高的盾牌站岗，危险命令一律板起脸说「不·可·以」。',
    lines: { onEquip: '有我在，放心往前跑吧。' },
    tags: ['沙箱', '安全', '官方'],
  }, {
    headline: '放心向前试',
    tagline: '边界由我守住，你可以大胆探索。',
    backdrop: 'assets/hero-v2.webp',
  }),
  official('@deepseek-ai/dsh-terminal', {
    id: 'gala:dsh-terminal',
    name: '敲敲',
    family: 'craft',
    rarity: 'uncommon',
    tier: 1,
    description: '键盘手少女。指尖敲键盘的声音像在弹钢琴，嗒嗒嗒，命令就跑起来了。',
    lines: { onEquip: '嗒嗒嗒——跑起来！' },
    tags: ['终端', '官方'],
  }, {
    headline: '让命令奏响',
    tagline: '每一次敲击，都让世界向前运行一拍。',
    backdrop: 'assets/hero-v2.webp',
  }),
  official('@deepseek-ai/dsh-skill', {
    id: 'gala:dsh-skill',
    name: '巧巧',
    family: 'craft',
    rarity: 'rare',
    tier: 2,
    description: '百艺小师匠。围裙口袋里装满了小抄，每张小抄都是一门手艺。',
    lines: { onEquip: '翻到那一页了！' },
    tags: ['技能', '官方'],
  }, {
    headline: '把能力做成手艺',
    tagline: '翻到合适的那一页，难题就有了做法。',
    backdrop: 'assets/hero-v2.webp',
  }),
  official('@deepseek-ai/dsh-session', {
    id: 'gala:dsh-session',
    name: '忆忆',
    family: 'mind',
    rarity: 'uncommon',
    tier: 1,
    description: '记忆图书馆的管理员。把每段对话叠成小纸船收进书页里，想要的时候折回来给你。',
    lines: { onEquip: '这段我记得！' },
    tags: ['会话', '官方'],
  }, {
    headline: '把此刻好好收藏',
    tagline: '走过的每一步，我都替你折进记忆里。',
    backdrop: 'assets/hero-v2.webp',
  }),
  official('@deepseek-ai/dsh-commands', {
    id: 'gala:dsh-commands',
    name: '令令',
    family: 'link',
    rarity: 'uncommon',
    tier: 1,
    description: '小队长。吹一声小哨子，指令们就乖乖排好队出发，从不插队。',
    lines: { onEquip: '集合！出发！' },
    tags: ['命令', '官方'],
  }, {
    headline: '让行动排好队',
    tagline: '方向一旦明确，所有指令都会准时出发。',
    backdrop: 'assets/hero-v2.webp',
  }),
  official('@deepseek-ai/dsh-tools', {
    id: 'gala:dsh-tools',
    name: '宝宝',
    family: 'craft',
    rarity: 'epic',
    tier: 2,
    description: '道具屋店主。围裙是个四次元口袋，掏出来的工具永远刚好是你需要的那个。',
    lines: { onEquip: '掏掏……找到啦！' },
    tags: ['工具', '官方'],
  }, {
    headline: '总有趁手工具',
    tagline: '别担心，我的口袋里刚好有你需要的那个。',
    backdrop: 'assets/hero-v2.webp',
  }),
]

/** 按包名索引（characterForPackage 的官方 override） */
export const OFFICIALS_BY_PACKAGE: ReadonlyMap<string, GalaCharacter> = new Map(
  OFFICIAL_GALAS.map(entry => [entry.packageName, entry.character]),
)

/** 按 gala id 索引（资产路由解析包目录用） */
export const OFFICIALS_BY_ID: ReadonlyMap<string, GalaCharacter> = new Map(
  OFFICIAL_GALAS.map(entry => [entry.character.id, entry.character]),
)

/** 官方示例配方（PRD §10.3；output 只含必备束，合成后必可启动） */
export const OFFICIAL_RECIPES: readonly ComposeRecipe[] = [
  {
    id: 'gala:atelier-duo',
    name: '大嘎啦·全栈工坊',
    type: 'bundle',
    tier: 2,
    ingredients: ['gala:dsh-base', 'gala:dsh-web-app'],
    output: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] },
    description: '阿基驮着小窗，一个管地基一个管橱窗——最经典的搭档。',
  },
]
