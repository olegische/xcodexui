declare module 'xcodex-runtime' {
  export const DEFAULT_CODEX_CONFIG: import('xcodex-runtime/types').CodexCompatibleConfig
  export const DEFAULT_DEMO_INSTRUCTIONS: import('xcodex-runtime/types').DemoInstructions
  export const XROUTER_PROVIDER_OPTIONS: ReadonlyArray<{
    value: import('xcodex-runtime/types').XrouterProvider
    label: string
    displayName: string
    baseUrl: string
  }>

  export function activeProviderApiKey(
    config: import('xcodex-runtime/types').CodexCompatibleConfig,
  ): string

  export function detectTransportMode(
    config: import('xcodex-runtime/types').CodexCompatibleConfig,
  ): import('xcodex-runtime/types').DemoTransportMode

  export function formatError(error: unknown): string

  export function getActiveProvider(
    config: import('xcodex-runtime/types').CodexCompatibleConfig,
  ): import('xcodex-runtime/types').CodexModelProviderConfig

  export function materializeCodexConfig(params: {
    transportMode: import('xcodex-runtime/types').DemoTransportMode
    model: string
    runtimeMode?: import('xcodex-runtime/types').RuntimeMode | null
    browserSecurity?: import('xcodex-runtime/types').BrowserSecurityConfig | null
    modelReasoningEffort: string | null
    personality: string | null
    displayName: string
    baseUrl: string
    apiKey: string
    xrouterProvider: import('xcodex-runtime/types').XrouterProvider
  }): import('xcodex-runtime/types').CodexCompatibleConfig

  export function normalizeCodexConfig(
    config: import('xcodex-runtime/types').CodexCompatibleConfig,
  ): import('xcodex-runtime/types').CodexCompatibleConfig

  export function createBrowserCodexRuntimeContext(
    options: import('xcodex-runtime/types').CreateBrowserCodexRuntimeContextOptions,
  ): Promise<import('xcodex-runtime/types').BrowserRuntimeContext>

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

  export {
    applyWorkspacePatch,
    createBrowserWorkspaceAdapter,
    createLocalStorageWorkspaceAdapter,
    listWorkspaceDir,
    loadStoredWorkspaceSnapshot,
    normalizeWorkspaceDirectoryPath,
    normalizeWorkspaceFilePath,
    readWorkspaceFile,
    saveStoredWorkspaceSnapshot,
    searchWorkspace,
  } from 'xcodex-runtime/workspace'
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
  export type JsonPrimitive = string | number | boolean | null
  export type JsonValue =
    | JsonPrimitive
    | JsonValue[]
    | { [key: string]: JsonValue }

  export type AuthState = {
    authMode: 'apiKey' | 'chatgpt' | 'chatgptAuthTokens'
    openaiApiKey: string | null
    accessToken: string | null
    refreshToken: string | null
    chatgptAccountId: string | null
    chatgptPlanType: string | null
    lastRefreshAt: number | null
  }

  export type Account = {
    email: string | null
    planType: string | null
    chatgptAccountId: string | null
    authMode: AuthState['authMode'] | null
  }

  export type DemoTransportMode = 'openai' | 'xrouter-browser' | 'openai-compatible'
  export type XrouterProvider = 'deepseek' | 'openai' | 'openrouter' | 'zai'
  export type ProviderKind = 'openai' | 'openai_compatible' | 'xrouter_browser'
  export type RuntimeMode = 'chat' | 'inspect' | 'interact' | 'agent' | 'chaos'

  export type BrowserSecurityConfig = {
    allowed_origins?: string[] | null
    allow_localhost?: boolean | null
    allow_private_network?: boolean | null
  }

  export type CodexModelProviderConfig = {
    name: string
    baseUrl: string
    envKey: string
    providerKind: ProviderKind
    wireApi: 'responses'
    metadata?: {
      xrouterProvider?: XrouterProvider | null
    } | null
  }

  export type CodexCompatibleConfig = {
    model: string
    modelProvider: string
    runtime_mode?: RuntimeMode | null
    runtime_architecture?: string | null
    browser_security?: BrowserSecurityConfig | null
    modelReasoningEffort: string | null
    personality: string | null
    modelProviders: Record<string, CodexModelProviderConfig>
    env: Record<string, string>
  }

  export type ModelPreset = {
    id: string
    displayName: string
    description?: string | null
    isDefault: boolean
    showInPicker: boolean
    supportsApi: boolean
  }

  export type DemoInstructions = {
    baseInstructions: string
    agentsDirectory: string
    agentsInstructions: string
    skillName: string
    skillPath: string
    skillContents: string
  }

  export type StoredUserConfig = {
    filePath: string
    version: string
    content: string
  }

  export type StoredThreadSessionMetadata = {
    threadId: string
    rolloutId: string
    createdAt: number
    updatedAt: number
    archived: boolean
    name: string | null
    preview: string
    cwd: string
    modelProvider: string
  }

  export type StoredThreadSession = {
    metadata: StoredThreadSessionMetadata
    items: JsonValue[]
  }

  export type BrowserCodexProtocolClient = {
    subscribeToNotifications(
      listener: (notification: { method: string; params: unknown }) => void,
    ): () => void
    threadResume(request: {
      threadId: string
      persistExtendedHistory?: boolean
    }): Promise<any>
    threadList(request: {
      archived?: boolean
      limit?: number
      sortKey?: string
      sourceKinds?: string[]
    }): Promise<any>
    threadRead(request: {
      threadId: string
      includeTurns?: boolean
    }): Promise<any>
    threadRollback(request: {
      threadId: string
      numTurns: number
    }): Promise<any>
    threadStart(request: {
      cwd: string
      model: string | null
      experimentalRawEvents?: boolean
      persistExtendedHistory?: boolean
    }): Promise<any>
    turnStart(request: {
      threadId: string
      input: unknown[]
      model: string | null
      effort: string | null
    }): Promise<any>
    turnInterrupt(request: {
      threadId: string
      turnId: string
    }): Promise<any>
  }

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

  export type BrowserToolApprovalKind =
    | 'code_execution'
    | 'network'
    | 'navigation'
    | 'mutation'
    | 'sensitive_read'

  export type BrowserToolApprovalOption =
    | 'allow_once'
    | 'allow_for_session'
    | 'deny'
    | 'abort'

  export type BrowserToolApprovalRequest = {
    approvalId: string
    toolName: string
    canonicalToolName: string
    requiredScopes: string[]
    runtimeMode: RuntimeMode
    origin: string
    displayOrigin: string
    targetOrigin: string | null
    targetUrl: string | null
    approvalKind: BrowserToolApprovalKind
    reason: string
    grantOptions: BrowserToolApprovalOption[]
  }

  export type BrowserToolApprovalResponse = {
    decision: BrowserToolApprovalOption
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
    requestBrowserToolApproval?: (
      request: import('xcodex-runtime/types').BrowserToolApprovalRequest,
    ) => Promise<import('xcodex-runtime/types').BrowserToolApprovalResponse>
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
