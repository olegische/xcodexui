declare module 'xcodex-runtime' {
  export {
    DEFAULT_CODEX_CONFIG,
    DEFAULT_DEMO_INSTRUCTIONS,
    XROUTER_PROVIDER_OPTIONS,
    activeProviderApiKey,
    detectTransportMode,
    formatError,
    getActiveProvider,
    materializeCodexConfig,
    normalizeCodexConfig,
  } from '@browser-codex/wasm-runtime-client'

  export function createBrowserCodexRuntimeContext(
    options: import('xcodex-runtime/types').CreateBrowserCodexRuntimeContextOptions,
  ): Promise<import('xcodex-runtime/types').BrowserRuntimeContext>
}

declare module 'xcodex-runtime/storage' {
  export function createIndexedDbCodexStorage<
    TAuthState,
    TConfig,
    TSession,
    TSessionMetadata,
  >(
    options: import('xcodex-runtime/types').CreateIndexedDbCodexStorageOptions<
      TAuthState,
      TConfig,
      TSession,
      TSessionMetadata
    >,
  ): import('xcodex-runtime/types').BrowserRuntimeStorage<
    TAuthState,
    TConfig,
    TSession,
    TSessionMetadata
  >
}

declare module 'xcodex-runtime/workspace' {
  export type {
    BrowserWorkspaceAdapter,
    JsonValue,
  } from 'xcodex-runtime/types'

  export type WorkspaceFileRecord = {
    path: string
    content: string
  }

  export type WorkspaceSnapshot = {
    rootPath: string
    files: WorkspaceFileRecord[]
  }

  export type WorkspaceStorageLike = Pick<Storage, 'getItem' | 'setItem'>
  export type WorkspaceEventTargetLike = Pick<EventTarget, 'dispatchEvent'>

  export type LocalStorageWorkspaceAdapterOptions = {
    rootPath?: string
    storageKey?: string
    storage?: WorkspaceStorageLike
    eventTarget?: WorkspaceEventTargetLike
  }

  export const DEFAULT_WORKSPACE_ROOT: string
  export const DEFAULT_WORKSPACE_STORAGE_KEY: string
  export const WORKSPACE_CHANGED_EVENT: string

  export function createLocalStorageWorkspaceAdapter(
    options?: LocalStorageWorkspaceAdapterOptions,
  ): import('xcodex-runtime/types').BrowserWorkspaceAdapter

  export function createBrowserWorkspaceAdapter(
    options?: LocalStorageWorkspaceAdapterOptions,
  ): import('xcodex-runtime/types').BrowserWorkspaceAdapter

  export function readWorkspaceFile(
    request: import('xcodex-runtime/types').JsonValue,
    options?: LocalStorageWorkspaceAdapterOptions,
  ): Promise<import('xcodex-runtime/types').JsonValue>

  export function listWorkspaceDir(
    request: import('xcodex-runtime/types').JsonValue,
    options?: LocalStorageWorkspaceAdapterOptions,
  ): Promise<import('xcodex-runtime/types').JsonValue>

  export function searchWorkspace(
    request: import('xcodex-runtime/types').JsonValue,
    options?: LocalStorageWorkspaceAdapterOptions,
  ): Promise<import('xcodex-runtime/types').JsonValue>

  export function applyWorkspacePatch(
    request: import('xcodex-runtime/types').JsonValue,
    options?: LocalStorageWorkspaceAdapterOptions,
  ): Promise<import('xcodex-runtime/types').JsonValue>

  export function loadStoredWorkspaceSnapshot(
    options?: LocalStorageWorkspaceAdapterOptions,
  ): Promise<WorkspaceSnapshot>

  export function saveStoredWorkspaceSnapshot(
    snapshot: WorkspaceSnapshot,
    options?: LocalStorageWorkspaceAdapterOptions,
  ): Promise<void>

  export function normalizeWorkspaceFilePath(
    path: string,
    options?: Pick<LocalStorageWorkspaceAdapterOptions, 'rootPath'>,
  ): string

  export function normalizeWorkspaceDirectoryPath(
    path: string,
    options?: Pick<LocalStorageWorkspaceAdapterOptions, 'rootPath'>,
  ): string
}

declare module 'xcodex-runtime/types' {
  export type {
    AuthState,
    Account,
    CodexCompatibleConfig,
    CodexModelProviderConfig,
    DemoInstructions,
    DemoTransportMode,
    ModelPreset,
    ProviderKind,
    StoredUserConfig,
    XrouterProvider,
  } from '@browser-codex/wasm-runtime-client'

  export type {
    JsonValue,
    StoredThreadSession,
    StoredThreadSessionMetadata,
  } from '@browser-codex/wasm-runtime-core/types'

  export type BrowserCodexProtocolClient =
    import('@browser-codex/wasm-browser-codex-runtime').BrowserCodexProtocolClient

  export type BrowserDynamicToolCatalogEntry = {
    toolName: string
    toolNamespace: string
    description: string
    inputSchema: import('xcodex-runtime/types').JsonValue
  }

  export type BrowserDynamicToolExecutor = {
    list(): Promise<{
      tools: BrowserDynamicToolCatalogEntry[]
    }>
    invoke(params: {
      callId: string
      toolName: string
      toolNamespace: string
      input: import('xcodex-runtime/types').JsonValue
    }): Promise<{
      output: import('xcodex-runtime/types').JsonValue
    }>
  }

  export type BrowserRuntimeNotification = {
    method: string
    params: unknown
  }

  export type BrowserWorkspaceAdapter = {
    readFile(request: import('xcodex-runtime/types').JsonValue): Promise<import('xcodex-runtime/types').JsonValue>
    listDir(request: import('xcodex-runtime/types').JsonValue): Promise<import('xcodex-runtime/types').JsonValue>
    search(request: import('xcodex-runtime/types').JsonValue): Promise<import('xcodex-runtime/types').JsonValue>
    applyPatch(request: import('xcodex-runtime/types').JsonValue): Promise<import('xcodex-runtime/types').JsonValue>
  }

  export type BrowserRuntimeClient = BrowserCodexProtocolClient & {
    loadAuthState(): Promise<import('xcodex-runtime/types').AuthState | null>
    saveAuthState(authState: import('xcodex-runtime/types').AuthState): Promise<void>
    clearAuthState(): Promise<void>
    listModels(request: {
      cursor: string | null
      limit: number | null
    }): Promise<{
      data: import('xcodex-runtime/types').ModelPreset[]
      nextCursor: string | null
    }>
  }

  export type BrowserRuntimeContext = {
    runtime: BrowserRuntimeClient
    loadConfig(): Promise<import('xcodex-runtime/types').CodexCompatibleConfig>
    saveConfig(config: import('xcodex-runtime/types').CodexCompatibleConfig): Promise<void>
    subscribe(listener: (notification: BrowserRuntimeNotification) => void): () => void
  }

  export type BrowserRuntimeStorage<
    TAuthState = import('xcodex-runtime/types').AuthState,
    TConfig = import('xcodex-runtime/types').CodexCompatibleConfig,
    TSession = import('xcodex-runtime/types').StoredThreadSession,
    TSessionMetadata = import('xcodex-runtime/types').StoredThreadSessionMetadata,
  > = {
    loadSession(threadId: string): Promise<TSession | null>
    saveSession(session: TSession): Promise<void>
    deleteSession(threadId: string): Promise<void>
    listSessions(): Promise<TSessionMetadata[]>
    loadAuthState(): Promise<TAuthState | null>
    saveAuthState(authState: TAuthState): Promise<void>
    clearAuthState(): Promise<void>
    loadConfig(): Promise<TConfig>
    saveConfig(config: TConfig): Promise<void>
    clearConfig(): Promise<void>
    loadUserConfig(): Promise<import('xcodex-runtime/types').StoredUserConfig | null>
    saveUserConfig(input: {
      filePath?: string | null
      expectedVersion?: string | null
      content: string
    }): Promise<import('xcodex-runtime/types').StoredUserConfig>
  }

  export type CreateIndexedDbCodexStorageOptions<
    TAuthState,
    TConfig,
    TSession,
    TSessionMetadata,
  > = {
    dbName: string
    dbVersion: number
    defaultConfig: TConfig
    normalizeConfig(config: TConfig): TConfig
    legacySessionStoreName?: string | null
    keys?: {
      authState?: string
      providerConfig?: string
      userConfig?: string
    }
    storeNames?: {
      threadSessions?: string
      authState?: string
      providerConfig?: string
      userConfig?: string
    }
    getSessionId(session: TSession): string
    getSessionMetadata(session: TSession): TSessionMetadata
  }

  export type CreateBrowserCodexRuntimeContextOptions = {
    codexHome?: string
    cwd: string
    storage: BrowserRuntimeStorage
    workspace: BrowserWorkspaceAdapter
    transport?: {
      loadRuntimeModule?: () => Promise<unknown>
      loadXrouterRuntime?: () => Promise<unknown>
    }
    telemetry?: {
      initializePageTelemetry?: boolean
    }
    dynamicTools?: BrowserDynamicToolExecutor
    bootstrap?: {
      baseInstructions?: string
      developerInstructions?: string | null
      userInstructions?: string | null
      ephemeral?: boolean
    }
    requestUserInput?: (request: {
      questions: Array<{
        id: string
        header: string
        question: string
        options: Array<{
          label: string
          description: string
        }>
      }>
    }) => Promise<{
      answers: Array<{
        id: string
        value: unknown
      }>
    }>
    readAccount?: (args: {
      authState: import('xcodex-runtime/types').AuthState | null
      config: import('xcodex-runtime/types').CodexCompatibleConfig
      allowRefresh: boolean
    }) => Promise<{
      account: import('xcodex-runtime/types').Account | null
      requiresOpenaiAuth: boolean
    }>
  }
}
