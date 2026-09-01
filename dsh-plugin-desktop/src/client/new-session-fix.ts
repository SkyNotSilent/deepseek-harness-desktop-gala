import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type {
  IWorkspaces,
  WorkspaceId,
  WorkspaceView,
} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

function currentWorkspace(
  items: readonly WorkspaceView[],
  current: SessionId,
  cwd: string | undefined,
): WorkspaceView | undefined {
  return items.find(item => item.sessionIds.includes(current))
    ?? (cwd === undefined ? undefined : items.find(item => item.path === cwd))
}

/**
 * Make New Session create a distinct blank session when alpha.2 would reconnect
 * the current blank session in the same Workspace.
 * @param uiWorkspace - public alpha.2 Workspace navigation service.
 * @param sessions - public alpha.2 Session Controller.
 * @param workspaces - public alpha.2 Workspace Controller.
 * @returns disposer restoring the upstream action.
 */
export function installCurrentBlankNewSessionFix(
  uiWorkspace: Pick<UiWorkspace, 'startSession'>,
  sessions: Pick<ISessions, 'list' | 'create' | 'open'>,
  workspaces: Pick<IWorkspaces, 'list'>,
): () => void {
  const upstream = uiWorkspace.startSession
  const pending = new Map<WorkspaceId, Promise<SessionId>>()
  let active = true

  const startSession = (workspaceId?: WorkspaceId): void => {
    const workspaceSnapshot = workspaces.list.getSnapshot()
    const sessionSnapshot = sessions.list.getSnapshot()
    const current = sessionSnapshot.current
    const currentSummary = current === undefined ? undefined : sessionSnapshot.byId[current]
    const currentTarget = current === undefined
      ? undefined
      : currentWorkspace(workspaceSnapshot.items, current, currentSummary?.cwd)
    const targetId = workspaceId ?? currentTarget?.workspaceId
    const target = targetId === undefined
      ? undefined
      : workspaceSnapshot.items.find(item => item.workspaceId === targetId)
    const currentBelongsToTarget = current !== undefined
      && target !== undefined
      && (target.sessionIds.includes(current) || currentSummary?.cwd === target.path)

    if (
      current === undefined
      || currentSummary?.blank !== true
      || target === undefined
      || !currentBelongsToTarget
      || workspaceSnapshot.archivedSessionIds.includes(current)
    ) {
      upstream.call(uiWorkspace, workspaceId)
      return
    }

    if (pending.has(target.workspaceId)) return

    const attempt = sessions.create({ workspaceId: target.workspaceId })
      .finally(() => { pending.delete(target.workspaceId) })
    pending.set(target.workspaceId, attempt)
    void attempt.then(
      sessionId => {
        if (!active || sessions.list.getSnapshot().current !== current) return
        sessions.open(sessionId)
      },
      reason => {
        if (active) console.warn('new session failed:', reason)
      },
    )
  }

  uiWorkspace.startSession = startSession
  return () => {
    active = false
    if (uiWorkspace.startSession === startSession) uiWorkspace.startSession = upstream
  }
}
