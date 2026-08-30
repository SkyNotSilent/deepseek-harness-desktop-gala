import type { SessionId, WorkspaceId } from '@deepseek-ai/dsh-api-remotes/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-client-runtime/client'

interface RuntimeSessionSummary {
  readonly id: SessionId
  readonly blank: boolean
}

interface RuntimeSessions {
  readonly list: {
    getSnapshot(): {
      readonly ids: readonly SessionId[]
      readonly byId: Readonly<Record<SessionId, RuntimeSessionSummary>>
      readonly current: SessionId | undefined
    }
  }
  create(options: { workspaceId: WorkspaceId }): Promise<SessionId>
  open(sessionId: SessionId): void
}

interface WorkspaceRuntimeWithSessions extends IWorkspaces {
  readonly sessions: RuntimeSessions
}

/**
 * Work around DSH 0.1.1-rc.2 reopening the current blank session when New Session is clicked.
 * @param publicWorkspaces - Workspace service exposed by the pinned client runtime.
 * @returns disposer restoring the upstream action.
 */
export function installCurrentBlankNewSessionFix(publicWorkspaces: IWorkspaces): () => void {
  const workspaces = publicWorkspaces as WorkspaceRuntimeWithSessions
  const upstream = workspaces.startSession
  const pending = new Map<WorkspaceId, Promise<SessionId>>()

  const startSession = (workspaceId?: WorkspaceId): void => {
    const workspaceSnapshot = workspaces.list.getSnapshot()
    const sessionSnapshot = workspaces.sessions.list.getSnapshot()
    const current = sessionSnapshot.current
    const currentWorkspace = current === undefined
      ? undefined
      : workspaceSnapshot.items.find(item => item.sessionIds.includes(current))
    const targetId = workspaceId ?? currentWorkspace?.workspaceId ?? workspaceSnapshot.recentWorkspaceId
    const target = targetId === undefined
      ? undefined
      : workspaceSnapshot.items.find(item => item.workspaceId === targetId)
    const currentSummary = current === undefined ? undefined : sessionSnapshot.byId[current]

    if (
      current !== undefined
      && currentSummary?.blank === true
      && target !== undefined
      && target.sessionIds.includes(current)
      && !workspaceSnapshot.archivedSessionIds.includes(current)
    ) {
      let attempt = pending.get(target.workspaceId)
      if (attempt === undefined) {
        attempt = workspaces.sessions.create({ workspaceId: target.workspaceId })
          .finally(() => { pending.delete(target.workspaceId) })
        pending.set(target.workspaceId, attempt)
      }
      void attempt.then(
        sessionId => { workspaces.sessions.open(sessionId) },
        reason => { console.warn('new session failed:', reason) },
      )
      return
    }

    upstream.call(workspaces, workspaceId)
  }

  workspaces.startSession = startSession
  return () => {
    if (workspaces.startSession === startSession) workspaces.startSession = upstream
  }
}
