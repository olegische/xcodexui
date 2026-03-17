import type { RpcNotification } from '../../api/codexRpcClient'

const listeners = new Set<(notification: RpcNotification) => void>()

export function emitWasmNotification(method: string, params: unknown): void {
  const notification: RpcNotification = {
    method,
    params,
    atIso: new Date().toISOString(),
  }
  for (const listener of listeners) {
    listener(notification)
  }
}

export function subscribeWasmNotifications(listener: (notification: RpcNotification) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
