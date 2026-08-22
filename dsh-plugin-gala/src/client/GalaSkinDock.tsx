/**
 * Gala皮肤图鉴 — 侧边栏原生入口 + 页面内选肤弹层
 *
 * 注册进官方声明的 `sidebar.footer.action` 扩展位（设置旁的动作位，
 * dsh-client-ui-sidebar 的合同），宽态整行按钮 / 窄态圆钮，样式全部走
 * `--dsw-alias-*` token（随皮肤变色）。点击弹出页面内弹层：10 位少女
 * （一人一肤）+ 3 套经典配色 + 恢复默认；确认经 loopback RPC 换肤，
 * token 与 logo 经既有 SSE 桥即时生效。Gala 层不可用时静默降级（§7.4）。
 */

import { useCallback, useEffect, useState } from 'react'

/** 选肤状态端点 */
export const PICKER_PATH = '/_dsh/desktop/gala/picker'
const APPLY_PATH = '/_dsh/desktop/gala/rpc/skin-apply'
const REVERT_PATH = '/_dsh/desktop/gala/rpc/skin-revert'

/** 弹层数据（GET /picker 的 picker 字段；结构由主进程 PickerState 保证） */
interface PickerGirl {
  skinId: string
  name: string
  quote: string
  rarityLabel: string
  art: string
  active: boolean
}
interface PickerClassic {
  skinId: string
  name: string
  swatch: string
  active: boolean
}
interface PickerData {
  girls: PickerGirl[]
  classics: PickerClassic[]
  activeSkinId: string | null
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

/** 解析 /picker 响应；结构不符返回 undefined（弹层显示加载失败） */
export function parsePickerData(payload: unknown): PickerData | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const picker = (payload as { picker?: unknown }).picker
  if (typeof picker !== 'object' || picker === null) return undefined
  const raw = picker as { girls?: unknown; classics?: unknown; activeSkinId?: unknown }
  if (!Array.isArray(raw.girls) || !Array.isArray(raw.classics)) return undefined
  return {
    girls: raw.girls.map((girl: Record<string, unknown>) => ({
      skinId: asString(girl.skinId),
      name: asString(girl.name),
      quote: asString(girl.quote),
      rarityLabel: asString(girl.rarityLabel),
      art: asString(girl.art),
      active: girl.active === true,
    })),
    classics: raw.classics.map((classic: Record<string, unknown>) => ({
      skinId: asString(classic.skinId),
      name: asString(classic.name),
      swatch: asString(classic.swatch, '#888888'),
      active: classic.active === true,
    })),
    activeSkinId: typeof raw.activeSkinId === 'string' ? raw.activeSkinId : null,
  }
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
  const [selected, setSelected] = useState<string | 'default' | undefined>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    let cancelled = false
    void fetch(PICKER_PATH, { cache: 'no-store' })
      .then(async response => (response.ok ? parsePickerData(await response.json()) : undefined))
      .then(parsed => {
        if (cancelled) return
        if (parsed === undefined) setFailed(true)
        else {
          setData(parsed)
          setSelected(parsed.activeSkinId ?? 'default')
        }
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
      const path = selected === 'default' ? REVERT_PATH : APPLY_PATH
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(selected === 'default' ? {} : { id: selected }),
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
  }, [selected, busy, onClose])

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
                    title={girl.quote}
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
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' }}>{girl.rarityLabel}</span>
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
                  style={{ ...girlCardStyle(selected === 'default'), flexDirection: 'row', gap: 8, padding: selected === 'default' ? '7px 11px' : '8px 12px' }}
                  onClick={() => { setSelected('default') }}
                >
                  <span style={{ fontSize: 13 }}>🐳 恢复默认</span>
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
          <button
            type="button"
            disabled={busy || data === undefined || selected === undefined}
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
