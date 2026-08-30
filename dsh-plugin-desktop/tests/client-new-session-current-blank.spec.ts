import type { SessionId, WorkspaceId } from '@deepseek-ai/dsh-api-remotes/client'
import { describe, expect, it, vi } from 'vitest'
import { installCurrentBlankNewSessionFix } from '../src/client/new-session-fix.ts'

const workspaceId = 'workspace-current' as WorkspaceId
const currentId = 'session-current-blank' as SessionId
const createdId = 'session-created' as SessionId

describe('patched New Session behavior', () => {
  it('creates a session instead of reopening the current blank session', async () => {
    const snapshot = {
      ids: [currentId],
      byId: {
        [currentId]: {
          id: currentId,
          blank: true,
          updatedAt: 1,
        },
      },
      current: currentId,
      phase: 'ready' as const,
    }
    const create = vi.fn(async () => createdId)
    const open = vi.fn()
    const sessions = {
      list: {
        getSnapshot: () => snapshot,
        subscribe: () => () => {},
      },
      create,
      open,
      clear: vi.fn(),
    }
    const upstream = vi.fn()
    const runtime = {
      sessions,
      startSession: upstream,
      list: {
        getSnapshot: () => ({
          items: [{
            workspaceId,
            path: '/tmp/current-workspace',
            title: 'current-workspace',
            sessionIds: [currentId],
            createdAt: '2026-08-30T00:00:00.000Z',
            updatedAt: '2026-08-30T00:00:00.000Z',
          }],
          archivedSessionIds: [],
          state: 'idle' as const,
          phase: 'ready' as const,
          error: null,
          baselinesReady: true,
          recentWorkspaceId: workspaceId,
        }),
      },
    }
    const dispose = installCurrentBlankNewSessionFix(runtime as never)

    runtime.startSession()

    await vi.waitFor(() => { expect(open).toHaveBeenCalledWith(createdId) })
    expect(create).toHaveBeenCalledWith({ workspaceId })
    expect(upstream).not.toHaveBeenCalled()

    dispose()
    expect(runtime.startSession).toBe(upstream)
  })

  it('leaves ordinary and cross-workspace New Session paths with the upstream runtime', () => {
    const otherWorkspaceId = 'workspace-other' as WorkspaceId
    const upstream = vi.fn()
    const runtime = {
      sessions: {
        list: {
          getSnapshot: () => ({
            ids: [currentId],
            byId: {
              [currentId]: {
                id: currentId,
                blank: false,
                cwd: '/tmp/current-workspace',
              },
            },
            current: currentId,
          }),
        },
        create: vi.fn(),
        open: vi.fn(),
      },
      startSession: upstream,
      list: {
        getSnapshot: () => ({
          items: [{
            workspaceId,
            path: '/tmp/current-workspace',
            title: 'current-workspace',
            sessionIds: [currentId],
            createdAt: '2026-08-30T00:00:00.000Z',
            updatedAt: '2026-08-30T00:00:00.000Z',
          }, {
            workspaceId: otherWorkspaceId,
            path: '/tmp/other-workspace',
            title: 'other-workspace',
            sessionIds: [],
            createdAt: '2026-08-30T00:00:00.000Z',
            updatedAt: '2026-08-30T00:00:00.000Z',
          }],
          archivedSessionIds: [],
          state: 'idle' as const,
          phase: 'ready' as const,
          error: null,
          baselinesReady: true,
          recentWorkspaceId: workspaceId,
        }),
      },
    }
    installCurrentBlankNewSessionFix(runtime as never)

    runtime.startSession(otherWorkspaceId)

    expect(upstream).toHaveBeenCalledWith(otherWorkspaceId)
  })
})
