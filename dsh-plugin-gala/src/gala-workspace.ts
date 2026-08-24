/** Host-owned workspace coordination contracts consumed by the Gala layer. */

export type GalaWorkspaceMode = 'shared' | 'isolated'

export interface GalaWorkspaceTarget {
  readonly personaId: string
  readonly name: string
}

export interface GalaActiveWorkspace extends GalaWorkspaceTarget {
  readonly profileName: string
}

export interface PersonaPluginDescriptor {
  readonly packageName: string
  readonly label: string
  readonly enabled: boolean
  readonly locked: boolean
  readonly available: boolean
  readonly restartRequired: boolean
  readonly reason?: string
}

export interface GalaWorkspaceSummary {
  readonly mode: GalaWorkspaceMode
  readonly sharedProfile: string
  readonly activeWorkspace: GalaActiveWorkspace | null
  readonly restartRequired: boolean
  readonly plugins: readonly PersonaPluginDescriptor[]
}

export interface GalaWorkspaceSwitchResult {
  readonly restarted: boolean
  readonly profileName: string
}

/**
 * Desktop implementation. All methods must finish validation before writing
 * launcher pending state; failures therefore leave the running workspace intact.
 */
export interface GalaWorkspaceHost {
  /** Appearance document for the profile backing this generation. */
  readonly appearanceStorePath: string
  summary(): GalaWorkspaceSummary
  enable(): Promise<GalaWorkspaceSummary>
  disable(activeAppearance: string | null): Promise<GalaWorkspaceSwitchResult>
  switchWorkspace(target: GalaWorkspaceTarget, appearance: string): Promise<GalaWorkspaceSwitchResult>
  stagePlugins(changes: Readonly<Record<string, boolean>>): Promise<GalaWorkspaceSummary>
  applyPlugins(): Promise<void>
}
