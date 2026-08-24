/**
 * Gala皮肤图鉴 — 侧边栏原生入口 + 页面内选肤弹层
 *
 * 注册进官方声明的 `sidebar.footer.action` 扩展位（设置旁的动作位，
 * dsh-client-ui-sidebar 的合同），宽态整行按钮 / 窄态圆钮，样式全部走
 * `--dsw-alias-*` token（随皮肤变色）。点击弹出页面内弹层：全员默认
 * + 10 位少女（一人一肤）+ 3 套经典配色；确认经 loopback RPC 换肤，
 * token 与 logo 经既有 SSE 桥即时生效。Gala 层不可用时静默降级（§7.4）。
 */

import { useCallback, useEffect, useState } from 'react'
import {
  GalaPersonaCard,
  GalaWorkspaceBrief,
  GalaWorkspaceExplainer,
  type PersonaProfileView,
} from './GalaWorkspaceExplainer.tsx'

/** 选肤状态端点 */
export const PICKER_PATH = '/_dsh/desktop/gala/picker'
const APPLY_PATH = '/_dsh/desktop/gala/rpc/skin-apply'
const REVERT_PATH = '/_dsh/desktop/gala/rpc/skin-revert'

/** 弹层数据（GET /picker 的 picker 字段；结构由主进程 PickerState 保证） */
interface PickerGirl {
  skinId: string
  characterId: string
  name: string
  isDefault: boolean
  quote: string
  rarityLabel: string
  art: string
  active: boolean
  archetype: string
}
interface PickerClassic {
  skinId: string
  name: string
  swatch: string
  active: boolean
}
interface PickerPlugin {
  packageName: string
  label: string
  enabled: boolean
  locked: boolean
  available: boolean
  restartRequired: boolean
  reason?: string
}
interface PickerData {
  girls: PickerGirl[]
  classics: PickerClassic[]
  activeSkinId: string | null
  workspaceMode: 'shared' | 'isolated'
  activeWorkspace: { personaId: string; name: string; profileName: string } | null
  activeAppearance: string | null
  restartRequired: boolean
  plugins: PickerPlugin[]
  personaEnabled: boolean
  activePersona: PersonaProfileView | null
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

/** 解析 /picker 响应；结构不符返回 undefined（弹层显示加载失败） */
export function parsePickerData(payload: unknown): PickerData | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const picker = (payload as { picker?: unknown }).picker
  if (typeof picker !== 'object' || picker === null) return undefined
  const raw = picker as Record<string, unknown>
  if (!Array.isArray(raw.girls) || !Array.isArray(raw.classics)) return undefined
  return {
    girls: raw.girls.map((girl: Record<string, unknown>) => ({
      skinId: asString(girl.skinId),
      characterId: asString(girl.characterId),
      name: asString(girl.name),
      isDefault: girl.isDefault === true,
      quote: asString(girl.quote),
      rarityLabel: asString(girl.rarityLabel),
      art: asString(girl.art),
      active: girl.active === true,
      archetype: asString(girl.archetype),
    })),
    classics: raw.classics.map((classic: Record<string, unknown>) => ({
      skinId: asString(classic.skinId),
      name: asString(classic.name),
      swatch: asString(classic.swatch, '#888888'),
      active: classic.active === true,
    })),
    activeSkinId: typeof raw.activeSkinId === 'string' ? raw.activeSkinId : null,
    workspaceMode: raw.workspaceMode === 'isolated' ? 'isolated' : 'shared',
    activeWorkspace: typeof raw.activeWorkspace === 'object' && raw.activeWorkspace !== null
      ? {
          personaId: asString((raw.activeWorkspace as Record<string, unknown>).personaId),
          name: asString((raw.activeWorkspace as Record<string, unknown>).name),
          profileName: asString((raw.activeWorkspace as Record<string, unknown>).profileName),
        }
      : null,
    activeAppearance: typeof raw.activeAppearance === 'string' ? raw.activeAppearance : null,
    restartRequired: raw.restartRequired === true,
    plugins: Array.isArray(raw.plugins) ? raw.plugins.map((plugin: Record<string, unknown>) => ({
      packageName: asString(plugin.packageName),
      label: asString(plugin.label),
      enabled: plugin.enabled === true,
      locked: plugin.locked === true,
      available: plugin.available !== false,
      restartRequired: plugin.restartRequired === true,
      ...(typeof plugin.reason === 'string' ? { reason: plugin.reason } : {}),
    })) : [],
    personaEnabled: raw.personaEnabled === true,
    activePersona: parsePersonaProfile(raw.activePersona),
  }
}

function parsePersonaProfile(value: unknown): PersonaProfileView | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  const name = asString(raw.name)
  const archetype = asString(raw.archetype)
  if (name === '' || archetype === '') return null
  return {
    characterId: asString(raw.characterId),
    name,
    archetype,
    story: asString(raw.story),
    catchphrases: Array.isArray(raw.catchphrases) ? raw.catchphrases.filter((item): item is string => typeof item === 'string') : [],
    authored: raw.authored === true,
  }
}

/** 换肤弹层状态行的“个性化人物”文案（导出以便单测三种分支）。 */
export function personaStatusLine(data: Pick<PickerData, 'personaEnabled' | 'activePersona'>): string {
  if (!data.personaEnabled) return '个性化人物未开启（默认关闭）'
  return data.activePersona !== null
    ? `个性化人物：${data.activePersona.name} · ${data.activePersona.archetype}`
    : '个性化人物：当前外观无可用人物'
}

async function loadPickerData(): Promise<PickerData> {
  const response = await fetch(PICKER_PATH, { cache: 'no-store' })
  const parsed = response.ok ? parsePickerData(await response.json()) : undefined
  if (parsed === undefined) throw new Error('角色空间状态不可用')
  return parsed
}

// ── 样式（全部 dsw token，随肤而变） ─────────────────────────────────

const wideButtonStyle: React.CSSProperties = {
  width: '100%',
  height: 49,
  border: 'none',
  background: 'none',
  color: 'var(--dsw-alias-label-primary)',
  cursor: 'pointer',
  borderRadius: 12,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 8px 0 6px',
  fontFamily: 'inherit',
  fontSize: 14,
  overflow: 'hidden',
}

const railButtonStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  border: 'none',
  background: 'none',
  color: 'var(--dsw-alias-label-primary)',
  cursor: 'pointer',
  borderRadius: '50%',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  fontSize: 17,
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 60,
  background: 'rgba(0, 0, 0, 0.42)',
  display: 'grid',
  placeItems: 'center',
}

const dialogStyle: React.CSSProperties = {
  width: 'min(720px, calc(100vw - 48px))',
  maxHeight: 'min(640px, calc(100vh - 64px))',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  borderRadius: 16,
  border: '1px solid var(--dsw-alias-border-l1)',
  background: 'var(--dsw-alias-bg-base)',
  color: 'var(--dsw-alias-label-primary)',
  boxShadow: 'var(--dsw-shadow-lv2, 0 12px 40px rgba(0,0,0,0.24))',
}

const girlCardStyle = (selected: boolean): React.CSSProperties => ({
  border: selected
    ? '2px solid var(--dsw-alias-brand-primary)'
    : '1px solid var(--dsw-alias-border-l2)',
  padding: selected ? 7 : 8,
  borderRadius: 14,
  background: selected ? 'var(--dsw-alias-interactive-bg-hover)' : 'none',
  cursor: 'pointer',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 6,
  fontFamily: 'inherit',
  color: 'inherit',
  textAlign: 'center',
})

// ── 弹层 ────────────────────────────────────────────────────────────

function SkinPickerDialog({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<PickerData | undefined>()
  const [failed, setFailed] = useState(false)
  const [selected, setSelected] = useState<string | 'original' | undefined>()
  const [restorePrompt, setRestorePrompt] = useState(false)
  const [busy, setBusy] = useState(false)
  const [workspaceBusy, setWorkspaceBusy] = useState(false)
  const [workspacePrompt, setWorkspacePrompt] = useState<'enable' | 'disable' | undefined>()
  const [personaBusy, setPersonaBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    let cancelled = false
    void loadPickerData()
      .then(parsed => {
        if (cancelled) return
        setData(parsed)
        setSelected(parsed.activeSkinId ?? 'original')
      })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [onClose])

  const confirm = useCallback(async () => {
    if (selected === undefined || busy) return
    setBusy(true)
    setError(undefined)
    try {
      if (selected === 'original' && data?.workspaceMode === 'isolated') {
        setRestorePrompt(true)
        return
      }
      const path = selected === 'original' ? REVERT_PATH : APPLY_PATH
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(selected === 'original' ? {} : { id: selected }),
      })
      const body: unknown = await response.json().catch(() => undefined)
      const ok = response.ok && (body as { ok?: unknown } | undefined)?.ok === true
      if (!ok) {
        const message = (body as { error?: unknown } | undefined)?.error
        throw new Error(typeof message === 'string' ? message : '换装失败，已回滚到上一套皮肤')
      }
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [selected, busy, onClose, data])

  const restoreOriginal = useCallback(async (choice: 'appearance-only' | 'exit-isolated') => {
    if (busy) return
    setBusy(true)
    setError(undefined)
    try {
      const response = await fetch('/_dsh/desktop/gala/rpc/appearance-original', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ choice }),
      })
      const body = await response.json().catch(() => ({})) as { ok?: boolean; error?: string }
      if (!response.ok || body.ok !== true) throw new Error(body.error ?? '恢复原装失败')
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setRestorePrompt(false)
    } finally {
      setBusy(false)
    }
  }, [busy, onClose])

  /** 开关独立空间：先展开说明卡，用户确认后才发 RPC。 */
  const confirmWorkspaceMode = useCallback(async () => {
    if (data === undefined || workspacePrompt === undefined || workspaceBusy || busy) return
    const action = workspacePrompt === 'enable' ? 'workspace-enable' : 'workspace-disable'
    setWorkspaceBusy(true)
    setError(undefined)
    try {
      await workspaceRpc(action)
      const next = await loadPickerData()
      setData(next)
      setSelected(next.activeSkinId ?? 'original')
      setWorkspacePrompt(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setWorkspaceBusy(false)
    }
  }, [busy, data, workspaceBusy, workspacePrompt])

  /** 就地开关个性化人物：即时生效、无需重启，无确认卡。 */
  const togglePersona = useCallback(async () => {
    if (data === undefined || personaBusy || busy) return
    setPersonaBusy(true)
    setError(undefined)
    try {
      await workspaceRpc('persona-toggle', { enabled: !data.personaEnabled })
      setData(await loadPickerData())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPersonaBusy(false)
    }
  }, [busy, data, personaBusy])

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Gala皮肤图鉴"
        style={dialogStyle}
        onClick={event => { event.stopPropagation() }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 18px',
            borderBottom: '1px solid var(--dsw-alias-border-l2)',
            flex: 'none',
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 600 }}>🎀 Gala皮肤图鉴</span>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            style={{ ...railButtonStyle, width: 28, height: 28, fontSize: 14, color: 'var(--dsw-alias-label-secondary)' }}
          >
            ✕
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 18px' }}>
          {failed && <p style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 13 }}>图鉴还没睡醒，稍后再试试吧。</p>}
          {!failed && data === undefined && (
            <p style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 13 }}>少女们正在换装…</p>
          )}
          {data !== undefined && (
            <>
              <div style={{ marginBottom: 12, padding: '9px 12px', borderRadius: 12, background: 'var(--dsw-alias-bg-l1)', fontSize: 12, color: 'var(--dsw-alias-label-secondary)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ flex: 1, minWidth: 220 }}>
                  外观：{data.activeSkinId === null ? '原装' : data.girls.find(girl => girl.skinId === data.activeSkinId)?.name ?? data.classics.find(item => item.skinId === data.activeSkinId)?.name ?? '自定义'}
                  {' ｜ '}工作台：{data.activeWorkspace?.name ?? '公共空间'}
                  {' ｜ '}{data.workspaceMode === 'isolated' ? '角色独立空间已开启' : '普通换肤模式'}
                </span>
                <button
                  type="button"
                  aria-pressed={data.workspaceMode === 'isolated'}
                  aria-expanded={workspacePrompt !== undefined}
                  disabled={workspaceBusy || busy}
                  onClick={() => { setWorkspacePrompt(current => current !== undefined ? undefined : data.workspaceMode === 'shared' ? 'enable' : 'disable') }}
                  title={data.workspaceMode === 'isolated' ? '关闭后回到公共插件空间；当前在角色工作台时将重启应用' : '为每个 IP 启用独立的插件编队与非敏感设置（点击查看说明）'}
                  style={{ border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 999, padding: '5px 10px', color: 'var(--dsw-alias-label-primary)', background: data.workspaceMode === 'isolated' ? 'var(--dsw-alias-interactive-bg-hover)' : 'var(--dsw-alias-bg-base)', cursor: workspaceBusy || busy ? 'default' : 'pointer', font: 'inherit', fontWeight: 600 }}
                >
                  {workspaceBusy ? '处理中…' : data.workspaceMode === 'isolated' ? '关闭独立空间' : '开启独立空间'}
                </button>
                <span style={{ flexBasis: '100%', display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' }}>
                  <span style={{ flex: 1, minWidth: 180 }}>
                    {personaStatusLine(data)}
                    {' ｜ '}插件编队在“设置 → 插件 → 角色空间”中管理。
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={data.personaEnabled}
                    disabled={personaBusy || busy}
                    onClick={() => { void togglePersona() }}
                    title={data.personaEnabled ? '关闭后所有角色都用平实语气回答' : '开启后换上角色皮肤，模型会用她的方式说话（即时生效）'}
                    style={{ border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 999, padding: '4px 10px', color: 'var(--dsw-alias-label-primary)', background: data.personaEnabled ? 'var(--dsw-alias-interactive-bg-hover)' : 'var(--dsw-alias-bg-base)', cursor: personaBusy || busy ? 'default' : 'pointer', font: 'inherit', fontSize: 11, fontWeight: 600, flex: 'none' }}
                  >
                    {personaBusy ? '处理中…' : data.personaEnabled ? '关闭个性化人物' : '开启个性化人物'}
                  </button>
                </span>
              </div>
              {workspacePrompt !== undefined && (
                <div style={{ marginBottom: 12 }}>
                  <GalaWorkspaceExplainer
                    mode={workspacePrompt}
                    busy={workspaceBusy}
                    activeWorkspaceName={data.activeWorkspace?.name ?? null}
                    onConfirm={() => { void confirmWorkspaceMode() }}
                    onCancel={() => { setWorkspacePrompt(undefined) }}
                  />
                </div>
              )}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))',
                  gap: 10,
                }}
              >
                {data.girls.map(girl => (
                  <button
                    key={girl.skinId}
                    type="button"
                    style={girlCardStyle(selected === girl.skinId)}
                    onClick={() => { setSelected(girl.skinId) }}
                    title={girl.archetype ? `${girl.archetype}｜${girl.quote}` : girl.quote}
                  >
                    <img
                      src={girl.art}
                      alt={girl.name}
                      width={84}
                      height={84}
                      style={{ width: 84, height: 84, borderRadius: 14, objectFit: 'cover' }}
                    />
                    <span style={{ fontSize: 13, fontWeight: 600 }}>
                      {girl.name}
                      {girl.active && <span style={{ color: 'var(--dsw-alias-brand-primary)' }}>（当前）</span>}
                      {girl.isDefault && (
                        <span
                          style={{
                            display: 'inline-block',
                            marginLeft: 5,
                            padding: '1px 5px',
                            borderRadius: 999,
                            background: 'var(--dsw-alias-brand-primary)',
                            color: 'var(--dsw-alias-label-on-color, #fff)',
                            fontSize: 10,
                            fontWeight: 700,
                            verticalAlign: 1,
                          }}
                        >
                          默认
                        </span>
                      )}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' }}>
                      {girl.archetype !== '' ? girl.archetype : girl.rarityLabel}
                    </span>
                  </button>
                ))}
              </div>

              <div style={{ margin: '16px 0 6px', fontSize: 12, color: 'var(--dsw-alias-label-caption)' }}>经典配色</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {data.classics.map(classic => (
                  <button
                    key={classic.skinId}
                    type="button"
                    style={{
                      ...girlCardStyle(selected === classic.skinId),
                      flexDirection: 'row',
                      gap: 8,
                      padding: selected === classic.skinId ? '7px 11px' : '8px 12px',
                    }}
                    onClick={() => { setSelected(classic.skinId) }}
                  >
                    <span
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: '50%',
                        background: classic.swatch,
                        flex: 'none',
                        border: '1px solid var(--dsw-alias-border-l2)',
                      }}
                    />
                    <span style={{ fontSize: 13 }}>{classic.name}</span>
                  </button>
                ))}
                <button
                  type="button"
                  style={{ ...girlCardStyle(selected === 'original'), flexDirection: 'row', gap: 8, padding: selected === 'original' ? '7px 11px' : '8px 12px' }}
                  onClick={() => { setSelected('original') }}
                >
                  <span style={{ fontSize: 13 }}>🐳 恢复原装</span>
                </button>
              </div>
            </>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 18px',
            borderTop: '1px solid var(--dsw-alias-border-l2)',
            flex: 'none',
          }}
        >
          {error !== undefined && (
            <span style={{ fontSize: 12, color: 'var(--dsw-alias-state-error-primary)', flex: 1, minWidth: 0 }}>{error}</span>
          )}
          {restorePrompt && (
            <div style={{ flex: 1, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 12 }}>当前工作台：{data?.activeWorkspace?.name ?? '公共空间'}</span>
              <button type="button" disabled={busy} onClick={() => { void restoreOriginal('appearance-only') }}>仅恢复原装外观</button>
              <button type="button" disabled={busy} onClick={() => { void restoreOriginal('exit-isolated') }}>恢复原装并退出独立空间</button>
              <button type="button" disabled={busy} onClick={() => { setRestorePrompt(false) }}>取消</button>
            </div>
          )}
          <button
            type="button"
            disabled={busy || workspaceBusy || data === undefined || selected === undefined || restorePrompt || workspacePrompt !== undefined}
            onClick={() => { void confirm() }}
            style={{
              marginLeft: 'auto',
              border: 'none',
              borderRadius: 999,
              padding: '8px 20px',
              fontSize: 14,
              fontWeight: 600,
              cursor: busy ? 'default' : 'pointer',
              opacity: busy || data === undefined ? 0.6 : 1,
              background: 'var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary))',
              color: '#fff',
              fontFamily: 'inherit',
            }}
          >
            {busy ? '换装中…' : '就决定是你了！'}
          </button>
        </div>
      </div>
    </div>
  )
}

async function workspaceRpc(action: string, body: Record<string, unknown> = {}): Promise<void> {
  const response = await fetch(`/_dsh/desktop/gala/rpc/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({})) as { ok?: boolean; error?: string }
  if (!response.ok || payload.ok !== true) throw new Error(payload.error ?? `操作失败（${response.status}）`)
}

/** “设置 → 插件 → 角色空间”正式页面。 */
export function GalaWorkspaceSettings() {
  const [data, setData] = useState<PickerData | undefined>()
  const [draft, setDraft] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string>()
  const [workspacePrompt, setWorkspacePrompt] = useState<'enable' | 'disable' | undefined>()
  const reload = useCallback(async () => {
    const response = await fetch(PICKER_PATH, { cache: 'no-store' })
    const parsed = response.ok ? parsePickerData(await response.json()) : undefined
    if (parsed === undefined) throw new Error('角色空间状态不可用')
    setData(parsed)
    setDraft(Object.fromEntries(parsed.plugins.map(plugin => [plugin.packageName, plugin.enabled])))
  }, [])
  useEffect(() => { void reload().catch(cause => { setMessage(String(cause)) }) }, [reload])

  const run = useCallback(async (action: string, body?: Record<string, unknown>) => {
    setBusy(true)
    setMessage(undefined)
    try {
      await workspaceRpc(action, body)
      await reload()
      setMessage(action === 'workspace-enable'
        ? '独立空间已开启；首次选择角色时会准备工作台并重启。'
        : action === 'workspace-disable'
          ? '已回到公共插件空间；角色空间数据仍保留。'
          : action === 'plugins-stage'
            ? '插件编队已保存，重启后生效。'
            : action === 'persona-toggle'
              ? (body?.enabled === false ? '个性化人物已关闭，角色将用平实语气回答。' : '个性化人物已开启，换上角色后即时生效。')
              : '操作已提交。')
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [reload])

  if (data === undefined) return <p style={{ color: 'var(--dsw-alias-label-secondary)' }}>正在读取角色空间…{message}</p>
  const appearanceName = data.activeSkinId === null
    ? '原装'
    : data.girls.find(item => item.skinId === data.activeSkinId)?.name
      ?? data.classics.find(item => item.skinId === data.activeSkinId)?.name ?? '自定义'
  return (
    <section style={{ display: 'grid', gap: 16, maxWidth: 760 }}>
      <div style={{ padding: 18, border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 16, background: 'var(--dsw-alias-bg-l1)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center' }}>
          <div>
            <h3 style={{ margin: 0 }}>角色独立空间（硬核）</h3>
            <p style={{ margin: '6px 0 0', color: 'var(--dsw-alias-label-secondary)', fontSize: 13 }}>每个 IP 保存自己的插件编队和非敏感设置；凭据、聊天与工作目录继续共享。</p>
          </div>
          <button
            type="button"
            disabled={busy}
            aria-expanded={workspacePrompt !== undefined}
            onClick={() => { setWorkspacePrompt(current => current !== undefined ? undefined : data.workspaceMode === 'shared' ? 'enable' : 'disable') }}
          >
            {data.workspaceMode === 'isolated' ? '关闭' : '开启'}
          </button>
        </div>
        <p style={{ margin: '14px 0 0', fontSize: 13 }}>外观：{appearanceName} ｜ 工作台：{data.activeWorkspace?.name ?? '公共空间'} ｜ {data.restartRequired ? '有待重启改动' : '已生效'}</p>
        {workspacePrompt !== undefined && (
          <div style={{ marginTop: 14 }}>
            <GalaWorkspaceExplainer
              mode={workspacePrompt}
              busy={busy}
              activeWorkspaceName={data.activeWorkspace?.name ?? null}
              onConfirm={() => {
                const action = workspacePrompt === 'enable' ? 'workspace-enable' : 'workspace-disable'
                setWorkspacePrompt(undefined)
                void run(action)
              }}
              onCancel={() => { setWorkspacePrompt(undefined) }}
            />
          </div>
        )}
        {workspacePrompt === undefined && (
          <div style={{ marginTop: 12 }}>
            <GalaWorkspaceBrief />
          </div>
        )}
      </div>

      <GalaPersonaCard
        enabled={data.personaEnabled}
        profile={data.activePersona}
        busy={busy}
        onToggle={enabled => { void run('persona-toggle', { enabled }) }}
      />

      <div style={{ padding: 18, border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 16 }}>
        <h3 style={{ margin: '0 0 6px' }}>插件编队</h3>
        <p style={{ margin: '0 0 12px', color: 'var(--dsw-alias-label-secondary)', fontSize: 13 }}>安装与升级继续在 DSH Terminal 完成。系统必需主链已锁定。</p>
        {data.plugins.length === 0 && <p style={{ fontSize: 13 }}>进入角色工作台后显示可编队插件。</p>}
        {data.plugins.map(plugin => (
          <label key={plugin.packageName} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: '1px solid var(--dsw-alias-border-l2)' }} title={plugin.reason}>
            <input type="checkbox" disabled={busy || plugin.locked || data.activeWorkspace === null} checked={draft[plugin.packageName] ?? false} onChange={event => { setDraft(current => ({ ...current, [plugin.packageName]: event.target.checked })) }} />
            <span style={{ flex: 1 }}>{plugin.label}<small style={{ display: 'block', color: 'var(--dsw-alias-label-tertiary)' }}>{plugin.packageName}</small></span>
            {plugin.locked && <span style={{ fontSize: 12 }}>🔒 必需</span>}
          </label>
        ))}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 14 }}>
          <button type="button" disabled={busy || data.activeWorkspace === null} onClick={() => { void run('plugins-stage', { changes: draft }) }}>保存编队</button>
          <button type="button" disabled={busy || !data.restartRequired} onClick={() => { void run('plugins-apply') }}>应用并重启</button>
        </div>
      </div>
      {message && <p role="status" style={{ margin: 0, fontSize: 13 }}>{message}</p>}
    </section>
  )
}

// ── 侧边栏入口 ──────────────────────────────────────────────────────

/** 侧边栏 foot 的「Gala皮肤图鉴」入口（sidebar.footer.action 扩展位） */
export function GalaSkinDock({ wide }: { wide: boolean }) {
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState(false)

  const button = wide
    ? (
        <button
          type="button"
          aria-label="打开 Gala皮肤图鉴"
          style={{
            ...wideButtonStyle,
            background: hover ? 'var(--dsw-alias-interactive-bg-hover-solid)' : 'none',
          }}
          onMouseEnter={() => { setHover(true) }}
          onMouseLeave={() => { setHover(false) }}
          onClick={() => { setOpen(true) }}
        >
          <span aria-hidden="true" style={{ fontSize: 16, flex: 'none' }}>🎀</span>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Gala皮肤图鉴
          </span>
        </button>
      )
    : (
        <button
          type="button"
          aria-label="打开 Gala皮肤图鉴"
          title="Gala皮肤图鉴"
          style={{
            ...railButtonStyle,
            background: hover ? 'var(--dsw-alias-interactive-bg-hover)' : 'none',
          }}
          onMouseEnter={() => { setHover(true) }}
          onMouseLeave={() => { setHover(false) }}
          onClick={() => { setOpen(true) }}
        >
          🎀
        </button>
      )

  return (
    <>
      {button}
      {open && <SkinPickerDialog onClose={() => { setOpen(false) }} />}
    </>
  )
}
