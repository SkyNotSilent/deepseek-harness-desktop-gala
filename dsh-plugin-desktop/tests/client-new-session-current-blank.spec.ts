import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ISessions, SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces, WorkspaceId, WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'
import { describe, expect, it, vi } from 'vitest'
import { installCurrentBlankNewSessionFix } from '../src/client/new-session-fix.ts'

const workspaceId = 'workspace-current' as WorkspaceId
const otherWorkspaceId = 'workspace-other' as WorkspaceId
const currentId = 'session-current-blank' as SessionId
const createdId = 'session-created' as SessionId
const secondCreatedId = 'session-created-second' as SessionId

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(reason: unknown): void } {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept
    reject = decline
  })
  return { promise, resolve, reject }
}

function createHarness(options: {
  blank?: boolean
  archived?: boolean
  create?: (call: number) => Promise<SessionId>
} = {}) {
  const sessionSnapshot: SessionListState = {
    ids: [currentId] as SessionId[],
    byId: {
      [currentId]: {
        id: currentId,
        blank: options.blank ?? true,
        cwd: '/tmp/current-workspace',
        displayTitle: 'current-workspace',
        running: false,
        updatedAt: 1,
      },
    } as Record<SessionId, SessionSummary>,
    current: currentId as SessionId | undefined,
    phase: 'ready' as const,
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  }
  const workspaceSnapshot: WorkspaceSnapshot = {
    items: [{
      workspaceId,
      path: '/tmp/current-workspace',
      title: 'current-workspace',
      sessionIds: [currentId] as SessionId[],
      createdAt: '2026-08-30T00:00:00.000Z',
      updatedAt: '2026-08-30T00:00:00.000Z',
    }, {
      workspaceId: otherWorkspaceId,
      path: '/tmp/other-workspace',
      title: 'other-workspace',
      sessionIds: [] as SessionId[],
      createdAt: '2026-08-30T00:00:00.000Z',
      updatedAt: '2026-08-30T00:00:00.000Z',
    }],
    archivedSessionIds: options.archived ? [currentId] : [] as SessionId[],
    state: 'idle' as const,
    phase: 'ready' as const,
    error: null,
  }
  let createCalls = 0
  const create = vi.fn<ISessions['create']>(async () => {
    createCalls += 1
    return options.create?.(createCalls) ?? (createCalls === 1 ? createdId : secondCreatedId)
  })
  const open = vi.fn<ISessions['open']>((id: SessionId) => {
    sessionSnapshot.current = id
    sessionSnapshot.ids.push(id)
    sessionSnapshot.byId[id] = {
      id,
      blank: true,
      cwd: '/tmp/current-workspace',
      displayTitle: 'current-workspace',
      running: false,
      updatedAt: createCalls + 1,
    }
  })
  const sessions: Pick<ISessions, 'list' | 'create' | 'open'> = {
    list: { getSnapshot: () => sessionSnapshot, subscribe: () => () => {} },
    create,
    open,
  }
  const workspaces: Pick<IWorkspaces, 'list'> = {
    list: { getSnapshot: () => workspaceSnapshot, subscribe: () => () => {} },
  }
  const upstream = vi.fn<UiWorkspace['startSession']>()
  const uiWorkspace: Pick<UiWorkspace, 'startSession'> = { startSession: upstream }
  const dispose = installCurrentBlankNewSessionFix(uiWorkspace, sessions, workspaces)
  return { create, dispose, open, sessions, uiWorkspace, upstream }
}

describe('alpha.2 New Session compatibility', () => {
  it('creates and opens a distinct session for the current blank Workspace', async () => {
    const harness = createHarness()

    harness.uiWorkspace.startSession()

    await vi.waitFor(() => { expect(harness.open).toHaveBeenCalledWith(createdId) })
    expect(harness.create).toHaveBeenCalledWith({ workspaceId })
    expect(harness.upstream).not.toHaveBeenCalled()
  })

  it('shares one pending create across rapid duplicate clicks', async () => {
    const first = deferred<SessionId>()
    const harness = createHarness({ create: () => first.promise })

    harness.uiWorkspace.startSession()
    harness.uiWorkspace.startSession()

    expect(harness.create).toHaveBeenCalledOnce()
    first.resolve(createdId)
    await vi.waitFor(() => { expect(harness.open).toHaveBeenCalledOnce() })
  })

  it('creates another id on the next click after the prior create settles', async () => {
    const harness = createHarness()

    harness.uiWorkspace.startSession()
    await vi.waitFor(() => { expect(harness.open).toHaveBeenCalledWith(createdId) })
    harness.uiWorkspace.startSession()

    await vi.waitFor(() => { expect(harness.open).toHaveBeenCalledWith(secondCreatedId) })
    expect(harness.create).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['a non-blank current session', { blank: false }, undefined],
    ['an archived current session', { archived: true }, undefined],
    ['an explicit different Workspace', {}, otherWorkspaceId],
  ] as const)('delegates %s to upstream', (_label, options, target) => {
    const harness = createHarness(options)

    harness.uiWorkspace.startSession(target)

    expect(harness.upstream).toHaveBeenCalledWith(target)
    expect(harness.create).not.toHaveBeenCalled()
  })

  it('clears a failed pending create so the next click can retry', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const harness = createHarness({
      create: async call => {
        if (call === 1) throw new Error('create failed')
        return createdId
      },
    })

    harness.uiWorkspace.startSession()
    await vi.waitFor(() => { expect(warn).toHaveBeenCalled() })
    harness.uiWorkspace.startSession()

    await vi.waitFor(() => { expect(harness.open).toHaveBeenCalledWith(createdId) })
    expect(harness.create).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })

  it('does not steal focus when the user navigates before creation settles', async () => {
    const first = deferred<SessionId>()
    const harness = createHarness({ create: () => first.promise })

    harness.uiWorkspace.startSession()
    harness.sessions.list.getSnapshot().current = 'session-user-opened' as SessionId
    first.resolve(createdId)
    await first.promise
    await Promise.resolve()

    expect(harness.open).not.toHaveBeenCalled()
  })

  it('ignores a late create after disposal and preserves a later HMR implementation', async () => {
    const first = deferred<SessionId>()
    const harness = createHarness({ create: () => first.promise })
    const later = vi.fn<UiWorkspace['startSession']>()

    harness.uiWorkspace.startSession()
    harness.uiWorkspace.startSession = later
    harness.dispose()
    first.resolve(createdId)
    await first.promise
    await Promise.resolve()

    expect(harness.open).not.toHaveBeenCalled()
    expect(harness.uiWorkspace.startSession).toBe(later)
  })

  it('restores the exact upstream function on dispose', () => {
    const harness = createHarness()

    harness.dispose()

    expect(harness.uiWorkspace.startSession).toBe(harness.upstream)
  })
})
