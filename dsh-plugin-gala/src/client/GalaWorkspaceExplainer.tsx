/**
 * 角色空间说明卡 + 人设卡 — 换肤弹层与“设置 → 插件 → 角色空间”共用。
 *
 * 开启“角色独立空间”不再是一键生效：先把它做什么、什么仍共享、要付出的代价
 * 和风险摊开给用户看，确认后才真正发起 RPC。关闭同样先确认（可能触发重启）。
 * 个性化人物卡展示当前角色的原型 / 故事 / 口头禅，并提供开关（默认关闭）。
 * 样式全部走 `--dsw-alias-*` token，随皮肤变色。
 */

import type { ReactNode } from 'react'

/** 说明文案单一来源：UI、测试与文档引用同一份。 */
export const WORKSPACE_EXPLAINER = {
  title: '开启「角色独立空间」前，先看这 30 秒',
  does: [
    '每个角色（全员、官方角色、自定义角色）拥有自己的一套插件编队和非敏感设置（模型、Shell、搜索等）。',
    '换角色 = 换工作台：先预览外观，确认后保存当前状态并重启应用，进入该角色的插件环境。',
    '角色之间互不影响：在灵灵那里关掉的插件，在阿念这里仍然开着。',
  ],
  shares: [
    'API Key 与凭据、聊天记录、工作目录、窗口偏好仍然共享——切换角色不会丢聊天，也不用重新填 Key。',
  ],
  costs: [
    '每次切换角色都要重启一次应用；经典配色与恢复原装不重启。',
    '首次进入某个角色时，会按当前公共配置生成它的工作台，占用少量磁盘；之后各自独立演化。',
    '在某个角色里通过 DSH Terminal 安装的新插件，其他角色默认关闭，需要各自手动开启。',
    '这是预览功能：若新工作台启动失败，会自动回到上一套可用配置与外观。',
    '关闭独立空间不会删除任何角色数据；需要时可手动清理。',
  ],
  suits: '适合想给不同角色配不同插件或模型、或想隔离实验插件的玩家。只想换皮肤的用户不需要开启。',
  confirm: '我了解，开启独立空间',
  cancel: '先不开',
} as const

export const WORKSPACE_DISABLE_EXPLAINER = {
  title: '关闭「角色独立空间」？',
  points: [
    '回到公共插件空间；当前外观保留。',
    '所有角色空间的数据留在磁盘上，重新开启时可继续使用。',
  ],
  restartNote: (name: string) => `当前正在「${name}」工作台，关闭会保存状态并重启应用。`,
  confirm: '关闭并回到公共空间',
  cancel: '取消',
} as const

const cardStyle: React.CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l1)',
  borderRadius: 14,
  padding: '14px 16px',
  background: 'var(--dsw-alias-bg-l1)',
  color: 'var(--dsw-alias-label-primary)',
  display: 'grid',
  gap: 10,
  fontSize: 13,
  lineHeight: 1.6,
}

const headingStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 14,
  fontWeight: 700,
}

const labelStyle: React.CSSProperties = {
  margin: '4px 0 2px',
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--dsw-alias-label-secondary)',
  letterSpacing: '0.04em',
}

const listStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: 18,
  display: 'grid',
  gap: 3,
}

const buttonRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 10,
  justifyContent: 'flex-end',
  flexWrap: 'wrap',
  marginTop: 4,
}

const primaryButtonStyle: React.CSSProperties = {
  border: 'none',
  borderRadius: 999,
  padding: '7px 16px',
  fontWeight: 600,
  fontFamily: 'inherit',
  fontSize: 13,
  cursor: 'pointer',
  background: 'var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary))',
  color: '#fff',
}

const secondaryButtonStyle: React.CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l1)',
  borderRadius: 999,
  padding: '7px 14px',
  fontFamily: 'inherit',
  fontSize: 13,
  cursor: 'pointer',
  background: 'var(--dsw-alias-bg-base)',
  color: 'var(--dsw-alias-label-primary)',
}

function Points({ label, items, tone }: { label: string; items: readonly string[]; tone?: 'warn' }) {
  return (
    <div>
      <p style={{ ...labelStyle, color: tone === 'warn' ? 'var(--dsw-alias-state-warning-primary, #c2760a)' : labelStyle.color }}>{label}</p>
      <ul style={listStyle}>
        {items.map(item => <li key={item}>{item}</li>)}
      </ul>
    </div>
  )
}

export interface WorkspaceExplainerProps {
  mode: 'enable' | 'disable'
  busy: boolean
  /** 当前所在工作台名；公共空间为 null */
  activeWorkspaceName: string | null
  onConfirm(): void
  onCancel(): void
}

/** 开启 / 关闭独立空间前的说明与确认卡。 */
export function GalaWorkspaceExplainer({ mode, busy, activeWorkspaceName, onConfirm, onCancel }: WorkspaceExplainerProps) {
  if (mode === 'disable') {
    const copy = WORKSPACE_DISABLE_EXPLAINER
    return (
      <section role="region" aria-label={copy.title} style={cardStyle} data-testid="workspace-explainer-disable">
        <h4 style={headingStyle}>{copy.title}</h4>
        <ul style={listStyle}>
          {copy.points.map(item => <li key={item}>{item}</li>)}
          {activeWorkspaceName !== null && <li>{copy.restartNote(activeWorkspaceName)}</li>}
        </ul>
        <div style={buttonRowStyle}>
          <button type="button" disabled={busy} onClick={onCancel} style={secondaryButtonStyle}>{copy.cancel}</button>
          <button type="button" disabled={busy} onClick={onConfirm} style={primaryButtonStyle}>{busy ? '处理中…' : copy.confirm}</button>
        </div>
      </section>
    )
  }
  const copy = WORKSPACE_EXPLAINER
  return (
    <section role="region" aria-label={copy.title} style={cardStyle} data-testid="workspace-explainer-enable">
      <h4 style={headingStyle}>🪐 {copy.title}</h4>
      <Points label="它会做什么" items={copy.does} />
      <Points label="仍然共享" items={copy.shares} />
      <Points label="代价与风险" items={copy.costs} tone="warn" />
      <p style={{ margin: 0, color: 'var(--dsw-alias-label-secondary)' }}>{copy.suits}</p>
      <div style={buttonRowStyle}>
        <button type="button" disabled={busy} onClick={onCancel} style={secondaryButtonStyle}>{copy.cancel}</button>
        <button type="button" disabled={busy} onClick={onConfirm} style={primaryButtonStyle}>{busy ? '处理中…' : copy.confirm}</button>
      </div>
    </section>
  )
}

/** 设置页里常驻的“这是什么”折叠说明，随时可回看。 */
export function GalaWorkspaceBrief() {
  const copy = WORKSPACE_EXPLAINER
  return (
    <details style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--dsw-alias-label-secondary)' }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' }}>独立空间是什么？有什么代价？</summary>
      <div style={{ display: 'grid', gap: 8, paddingTop: 8 }}>
        <Points label="它会做什么" items={copy.does} />
        <Points label="仍然共享" items={copy.shares} />
        <Points label="代价与风险" items={copy.costs} tone="warn" />
        <p style={{ margin: 0 }}>{copy.suits}</p>
      </div>
    </details>
  )
}

/** 当前人设摘要（与主进程 GalaPersonaProfile 对齐） */
export interface PersonaProfileView {
  characterId: string
  name: string
  archetype: string
  story: string
  catchphrases: readonly string[]
  authored: boolean
}

export interface PersonaCardProps {
  enabled: boolean
  profile: PersonaProfileView | null
  busy: boolean
  onToggle(enabled: boolean): void
  /** 额外操作位（例如“去换一位角色”） */
  extra?: ReactNode
}

export const PERSONA_CARD_COPY = {
  title: '个性化人物',
  description: '开启后，换上角色皮肤时模型会用她的方式说话；代码、命令与事实不受影响。默认关闭；全员、经典配色和原装始终不带人物语气。',
  none: '当前外观没有可用的个性化人物（全员 / 经典配色 / 原装）。换上一位角色，她就会用自己的语气回答。',
  disabled: '未开启：所有角色都用平实语气回答。打开开关即可让她“进入角色”，换肤即时生效、无需重启。',
  fallback: '这位自定义角色没有正式人物设定，会按它的简介轻轻带一点语气。',
} as const

/** 人设卡：开关 + 当前角色原型、故事与口头禅。 */
export function GalaPersonaCard({ enabled, profile, busy, onToggle, extra }: PersonaCardProps) {
  return (
    <section aria-label={PERSONA_CARD_COPY.title} style={{ padding: 18, border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 16 }} data-testid="persona-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center' }}>
        <div>
          <h3 style={{ margin: 0 }}>💬 {PERSONA_CARD_COPY.title}</h3>
          <p style={{ margin: '6px 0 0', color: 'var(--dsw-alias-label-secondary)', fontSize: 13 }}>{PERSONA_CARD_COPY.description}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          disabled={busy}
          onClick={() => { onToggle(!enabled) }}
          style={{ ...secondaryButtonStyle, background: enabled ? 'var(--dsw-alias-interactive-bg-hover)' : 'var(--dsw-alias-bg-base)', fontWeight: 600, flex: 'none' }}
        >
          {busy ? '处理中…' : enabled ? '已开启' : '已关闭'}
        </button>
      </div>
      <div style={{ marginTop: 14, fontSize: 13, lineHeight: 1.7 }}>
        {!enabled && <p style={{ margin: 0, color: 'var(--dsw-alias-label-tertiary)' }}>{PERSONA_CARD_COPY.disabled}</p>}
        {enabled && profile === null && <p style={{ margin: 0, color: 'var(--dsw-alias-label-tertiary)' }}>{PERSONA_CARD_COPY.none}</p>}
        {enabled && profile !== null && (
          <div style={cardStyle} data-testid="persona-profile">
            <p style={{ margin: 0 }}>
              <b>{profile.name}</b>
              <span style={{ marginLeft: 8, padding: '1px 8px', borderRadius: 999, background: 'var(--dsw-alias-brand-primary)', color: '#fff', fontSize: 11, fontWeight: 700 }}>{profile.archetype}</span>
            </p>
            <p style={{ margin: 0 }}>{profile.story}</p>
            {profile.catchphrases.length > 0 && (
              <p style={{ margin: 0, color: 'var(--dsw-alias-label-secondary)' }}>
                口头禅：{profile.catchphrases.map(line => `「${line}」`).join('')}
              </p>
            )}
            {!profile.authored && <p style={{ margin: 0, color: 'var(--dsw-alias-label-tertiary)', fontSize: 12 }}>{PERSONA_CARD_COPY.fallback}</p>}
          </div>
        )}
        {extra}
      </div>
    </section>
  )
}
