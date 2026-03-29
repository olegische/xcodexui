import type { RuntimeMode } from 'xcodex-runtime/types'

export type RuntimeModeTone = 'neutral' | 'warning' | 'danger'

export type RuntimeModePresentation = {
  runtimeMode: RuntimeMode
  label: string
  description: string
  tone: RuntimeModeTone
  confirmationText: string | null
}

const MODE_ORDER: RuntimeMode[] = ['chat', 'inspect', 'interact', 'agent', 'chaos']

const MODE_PRESENTATIONS: Record<RuntimeMode, RuntimeModePresentation> = {
  chat: {
    runtimeMode: 'chat',
    label: 'Chat',
    description: 'No browser tools or workspace access. Use this when you want a plain chat-only runtime.',
    tone: 'neutral',
    confirmationText: null,
  },
  inspect: {
    runtimeMode: 'inspect',
    label: 'Inspect',
    description: 'Read-only page inspection. The runtime can inspect the current page, but it cannot click, type, or navigate.',
    tone: 'neutral',
    confirmationText: null,
  },
  interact: {
    runtimeMode: 'interact',
    label: 'Interact',
    description: 'Page interaction without navigation. The runtime can click and fill on the current page, but it cannot open a new URL.',
    tone: 'warning',
    confirmationText: 'Interact mode enables browser clicks and form input on the current page. Navigation stays blocked. Save anyway?',
  },
  agent: {
    runtimeMode: 'agent',
    label: 'Agent',
    description: 'Browser interaction plus workspace access. The runtime can inspect and interact with the current page and read or write files in the workspace.',
    tone: 'warning',
    confirmationText: 'Agent mode enables page interaction and workspace read or write access. Save anyway?',
  },
  chaos: {
    runtimeMode: 'chaos',
    label: 'Chaos',
    description: 'Full browser and workspace access. Approval-gated tools may navigate, evaluate page JavaScript, and use the workspace.',
    tone: 'danger',
    confirmationText: 'Chaos mode enables full browser and workspace access. Approval-gated tools may navigate, evaluate page JavaScript, inspect storage, and modify workspace files. Save anyway?',
  },
}

export function isRuntimeMode(value: unknown): value is RuntimeMode {
  return typeof value === 'string' && value in MODE_PRESENTATIONS
}

export function normalizeRuntimeMode(value: unknown): RuntimeMode {
  if (isRuntimeMode(value)) return value
  if (value === 'default') return 'chat'
  if (value === 'demo') return 'inspect'
  return 'chat'
}

export function getRuntimeModePresentation(runtimeMode: RuntimeMode): RuntimeModePresentation {
  return MODE_PRESENTATIONS[runtimeMode]
}

export function listRuntimeModes(): RuntimeMode[] {
  return [...MODE_ORDER]
}
