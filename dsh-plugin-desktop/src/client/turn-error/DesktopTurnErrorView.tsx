/** Actionable replacement for the terminal turn-error renderer. */

import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { DESKTOP_CONVERSATION_NS } from './locales.ts'

export const DEEPSEEK_BALANCE_URL = 'https://platform.deepseek.com/top_up'

export interface TurnErrorFailure {
  code?: string | undefined
  message: string
}

export type TurnErrorKind = 'quota' | 'generic'

/** Classify only explicit quota evidence; authentication and throttling remain generic. */
export function classifyTurnError(failure: TurnErrorFailure): TurnErrorKind {
  if (failure.code === 'QUOTA' || failure.code === 'HTTP_402') return 'quota'
  return /(?:insufficient[\s_-]+(?:balance|quota|credits?)|余额不足)/iu.test(failure.message)
    ? 'quota'
    : 'generic'
}

export type DesktopTurnErrorProps = PropsRuntime<'conversation.chat.node', 'turn-error'>
  & PropsLocale<typeof DESKTOP_CONVERSATION_NS>

const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '14px minmax(0, 1fr) auto',
  gap: 10,
  alignItems: 'start',
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 13,
  lineHeight: 1.55,
}

/** Render a quota action or preserve the upstream generic failure semantics. */
export function DesktopTurnErrorView({ node, t }: DesktopTurnErrorProps): React.JSX.Element {
  const failure = node.data
  const quota = classifyTurnError(failure) === 'quota'
  return <div style={rowStyle} role="status">
    <span
      aria-hidden="true"
      style={{ width: 8, height: 8, marginTop: 6, borderRadius: '50%', background: 'var(--dsw-static-red-500, #dc2626)' }}
    />
    <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
      <strong style={{ color: 'var(--dsw-alias-label-primary)' }}>
        {t(quota ? 'quota.title' : 'turnError.title')}
      </strong>
      {quota
        ? <>
            <span>{t('quota.body')}</span>
            <a
              href={DEEPSEEK_BALANCE_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--dsw-static-deepseek-500)', width: 'fit-content' }}
            >{t('quota.topUp')}</a>
            <details>
              <summary style={{ cursor: 'pointer' }}>{t('quota.detail')}</summary>
              <span style={{ overflowWrap: 'anywhere' }}>{failure.message}</span>
            </details>
          </>
        : <span style={{ overflowWrap: 'anywhere' }}>{failure.message}</span>}
    </div>
    {failure.code === undefined ? null : <code>{failure.code}</code>}
  </div>
}
