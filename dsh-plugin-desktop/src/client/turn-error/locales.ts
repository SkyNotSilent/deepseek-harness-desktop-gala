/** Desktop-owned copy for actionable terminal conversation failures. */

export const DESKTOP_CONVERSATION_NS = 'desktop.conversation'

export const DESKTOP_CONVERSATION_ZH = {
  'turnError.title': '本轮运行失败',
  'quota.title': '余额不足',
  'quota.body': '当前 DeepSeek API 账户余额不足，充值或更换可用凭据后即可继续。',
  'quota.topUp': '前往充值',
  'quota.detail': '查看原始错误',
} as const

export type DesktopConversationLocaleKey = keyof typeof DESKTOP_CONVERSATION_ZH

export const DESKTOP_CONVERSATION_EN: Record<DesktopConversationLocaleKey, string> = {
  'turnError.title': 'This turn failed',
  'quota.title': 'Insufficient balance',
  'quota.body': 'The current DeepSeek API account has insufficient balance. Top up or use another credential to continue.',
  'quota.topUp': 'Open billing',
  'quota.detail': 'Show original error',
}

export const DESKTOP_CONVERSATION_LOCALES = {
  zh: DESKTOP_CONVERSATION_ZH,
  en: DESKTOP_CONVERSATION_EN,
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'desktop.conversation': DesktopConversationLocaleKey
  }
}
