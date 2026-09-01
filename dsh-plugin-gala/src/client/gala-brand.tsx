/** Gala occupants for the official alpha.2 brand slots. */

import { useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { BrandWordmark, FishLogo } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { GALA_EVENTS_PATH, GALA_PICKER_PATH } from './gala-paths.ts'

/** Current character identity projected into the three brand seats. */
export interface GalaLogoInfo {
  art: string
  name: string
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** alpha.2 official hero-brand slot, mirrored locally to avoid host/client Context convergence. */
    'conversation.hero.brand.mark': {
      kind: 'single'
      scope: 'session-maybe'
      owner: { size: number; className?: string | undefined }
    }
  }
}

function isSafeLogoArt(art: string): boolean {
  return art.startsWith('/') || art.startsWith('data:image/')
}

/** Parse a same-origin character mark from GET /picker. */
export function parsePickerLogo(payload: unknown): GalaLogoInfo | null {
  if (typeof payload !== 'object' || payload === null) return null
  const picker = (payload as { picker?: unknown }).picker
  if (typeof picker !== 'object' || picker === null) return null
  const logo = (picker as { logo?: unknown }).logo
  if (typeof logo !== 'object' || logo === null) return null
  const art = (logo as { art?: unknown }).art
  const name = (logo as { name?: unknown }).name
  if (typeof art !== 'string' || typeof name !== 'string' || !isSafeLogoArt(art)) return null
  return { art, name }
}

let currentLogo: GalaLogoInfo | null = null
const listeners = new Set<() => void>()

function publishLogo(logo: GalaLogoInfo | null): void {
  currentLogo = logo
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function useGalaLogo(): GalaLogoInfo | null {
  return useSyncExternalStore(subscribe, () => currentLogo, () => null)
}

/** Pure mark view retained for headless rendering tests. */
export function GalaBrandMarkView({
  logo,
  size,
  className,
}: {
  logo: GalaLogoInfo | null
  size: number
  className?: string | undefined
}): React.JSX.Element {
  if (logo === null) return <FishLogo size={size} className={className} />
  return <img
    src={logo.art}
    alt={logo.name}
    className={className}
    style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flex: 'none' }}
  />
}

/** Pure name view retained for headless rendering tests. */
export function GalaBrandNameView({ logo }: { logo: GalaLogoInfo | null }): React.JSX.Element {
  if (logo === null) return <BrandWordmark includeMark={false} />
  return <span style={{ fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap' }}>{logo.name}</span>
}

/** Live slot occupant for sidebar and hero marks. */
export function GalaBrandMark(props: { size: number; className?: string | undefined }): React.JSX.Element {
  return <GalaBrandMarkView logo={useGalaLogo()} {...props} />
}

/** Live slot occupant for the expanded sidebar name. */
export function GalaBrandName(): React.JSX.Element {
  return <GalaBrandNameView logo={useGalaLogo()} />
}

/** Register the three alpha.2 brand cells below the official occupant's priority. */
export function registerGalaBrandSlots(ctx: Context): void {
  ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.register(
    { name: 'sidebar.brand.mark', priority: -1 },
    GalaBrandMark,
  ))
  ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register(
    { name: 'sidebar.brand.name', priority: -1 },
    GalaBrandName,
  ))
  ctx.slots.inject('conversation.hero.brand.mark', () => ctx.slots.register(
    { name: 'conversation.hero.brand.mark', priority: -1 },
    GalaBrandMark,
  ))
}

export interface GalaBrandSyncIo {
  fetchImpl?: typeof fetch
  eventSource?: (url: string) => {
    close(): void
    addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
  }
  publish?: (logo: GalaLogoInfo | null) => void
}

/** Keep the slot occupants synchronized with the active character skin. */
export function startGalaBrandSync(io: GalaBrandSyncIo = {}): () => void {
  const fetchImpl = io.fetchImpl ?? fetch.bind(globalThis)
  const publish = io.publish ?? publishLogo
  let stopped = false

  const refresh = async (): Promise<void> => {
    try {
      const response = await fetchImpl(GALA_PICKER_PATH, { cache: 'no-store' })
      if (!response.ok) return
      const logo = parsePickerLogo(await response.json())
      if (!stopped) publish(logo)
    } catch {
      // Missing Gala Host must never prevent the official UI from rendering.
    }
  }

  void refresh()
  let source: ReturnType<NonNullable<GalaBrandSyncIo['eventSource']>> | undefined
  try {
    source = (io.eventSource ?? ((url: string) => new EventSource(url)))(GALA_EVENTS_PATH)
    source.addEventListener('message', event => {
      if (event.data === 'skin-changed') void refresh()
    })
  } catch {
    // The initial fetch remains useful when SSE is unavailable.
  }

  return () => {
    stopped = true
    source?.close()
    if (io.publish === undefined) publishLogo(null)
  }
}
