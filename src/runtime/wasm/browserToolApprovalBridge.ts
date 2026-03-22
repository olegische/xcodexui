import type { RpcNotification } from '../../api/codexRpcClient'

type BrowserToolApprovalKind =
  | 'code_execution'
  | 'network'
  | 'navigation'
  | 'mutation'
  | 'sensitive_read'

type BrowserToolApprovalOption =
  | 'allow_once'
  | 'allow_for_session'
  | 'deny'
  | 'abort'

export type BrowserToolApprovalRequest = {
  approvalId: string
  toolName: string
  canonicalToolName: string
  requiredScopes: string[]
  runtimeMode: 'default' | 'demo' | 'chaos'
  origin: string
  displayOrigin: string
  targetOrigin: string | null
  targetUrl: string | null
  approvalKind: BrowserToolApprovalKind
  reason: string
  grantOptions: BrowserToolApprovalOption[]
}

type BrowserToolApprovalResponse = {
  decision: BrowserToolApprovalOption
}

type PendingBrowserToolApproval = {
  id: number
  method: 'item/browserTool/requestApproval'
  receivedAtIso: string
  params: {
    reason: string
    request: BrowserToolApprovalRequest
  }
  resolve: (response: BrowserToolApprovalResponse) => void
  reject: (error: Error) => void
}

let nextPendingRequestId = 1
const pendingApprovals = new Map<number, PendingBrowserToolApproval>()
const notificationListeners = new Set<(notification: RpcNotification) => void>()

function emitNotification(method: string, params: unknown): void {
  const notification: RpcNotification = {
    method,
    params,
    atIso: new Date().toISOString(),
  }
  notificationListeners.forEach((listener) => {
    listener(notification)
  })
}

function formatApprovalReason(request: BrowserToolApprovalRequest): string {
  const target = request.targetUrl ?? request.targetOrigin ?? request.displayOrigin
  const segments = [
    `Browser tool approval required for ${request.canonicalToolName}.`,
    request.reason.trim(),
    target ? `Target: ${target}` : '',
    `Mode: ${request.runtimeMode}`,
  ].filter((value) => value.length > 0)
  return segments.join(' ')
}

export function subscribeBrowserToolApprovalNotifications(
  listener: (notification: RpcNotification) => void,
): () => void {
  notificationListeners.add(listener)
  return () => {
    notificationListeners.delete(listener)
  }
}

export async function requestBrowserToolApproval(
  request: BrowserToolApprovalRequest,
): Promise<BrowserToolApprovalResponse> {
  return await new Promise<BrowserToolApprovalResponse>((resolve, reject) => {
    const id = nextPendingRequestId++
    const pending: PendingBrowserToolApproval = {
      id,
      method: 'item/browserTool/requestApproval',
      receivedAtIso: new Date().toISOString(),
      params: {
        reason: formatApprovalReason(request),
        request,
      },
      resolve,
      reject,
    }

    pendingApprovals.set(id, pending)
    emitNotification('server/request', {
      id: pending.id,
      method: pending.method,
      receivedAtIso: pending.receivedAtIso,
      params: pending.params,
    })
  })
}

export async function getPendingBrowserToolApprovalRequests(): Promise<Array<{
  id: number
  method: string
  receivedAtIso: string
  params: unknown
}>> {
  return [...pendingApprovals.values()].map((pending) => ({
    id: pending.id,
    method: pending.method,
    receivedAtIso: pending.receivedAtIso,
    params: pending.params,
  }))
}

export async function replyToBrowserToolApprovalRequest(
  id: number,
  payload: { result?: unknown; error?: { code?: number; message: string } },
): Promise<void> {
  const pending = pendingApprovals.get(id)
  if (!pending) {
    throw new Error(`No pending browser tool approval found for id ${String(id)}`)
  }

  pendingApprovals.delete(id)
  emitNotification('server/request/resolved', { id })

  if (payload.error) {
    pending.reject(new Error(payload.error.message))
    return
  }

  const result = payload.result !== null && typeof payload.result === 'object'
    ? payload.result as Record<string, unknown>
    : null
  const decision = result?.decision
  if (
    decision !== 'allow_once'
    && decision !== 'allow_for_session'
    && decision !== 'deny'
    && decision !== 'abort'
  ) {
    pending.reject(new Error('Browser approval reply must include a valid decision.'))
    return
  }

  pending.resolve({ decision })
}
