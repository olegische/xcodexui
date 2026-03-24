const OPENROUTER_OAUTH_STATE_STORAGE_KEY = 'xcodexui.openrouter.oauth.pkce'
const OPENROUTER_AUTH_URL = 'https://openrouter.ai/auth'
const OPENROUTER_AUTH_KEYS_URL = 'https://openrouter.ai/api/v1/auth/keys'
const OPENROUTER_CODE_CHALLENGE_METHOD = 'S256'

type OpenRouterOauthState = {
  codeVerifier: string
  createdAtMs: number
}

export type OpenRouterOauthCallbackResult =
  | {
    status: 'idle'
  }
  | {
    status: 'success'
    key: string
  }
  | {
    status: 'error'
    message: string
  }

export function isOpenRouterOauthSupported(): boolean {
  return (
    typeof window !== 'undefined'
    && typeof window.crypto !== 'undefined'
    && typeof window.crypto.getRandomValues === 'function'
    && typeof window.crypto.subtle !== 'undefined'
    && typeof window.sessionStorage !== 'undefined'
  )
}

export async function startOpenRouterOauthFlow(): Promise<void> {
  if (!isOpenRouterOauthSupported()) {
    throw new Error('This browser does not support the OpenRouter OAuth flow.')
  }

  const codeVerifier = createCodeVerifier()
  const codeChallenge = await createCodeChallenge(codeVerifier)
  const callbackUrl = createCallbackUrl()
  const authUrl = new URL(OPENROUTER_AUTH_URL)
  authUrl.searchParams.set('callback_url', callbackUrl)
  authUrl.searchParams.set('code_challenge', codeChallenge)
  authUrl.searchParams.set('code_challenge_method', OPENROUTER_CODE_CHALLENGE_METHOD)

  saveOauthState({
    codeVerifier,
    createdAtMs: Date.now(),
  })

  window.location.assign(authUrl.toString())
}

export async function consumeOpenRouterOauthCallback(): Promise<OpenRouterOauthCallbackResult> {
  if (typeof window === 'undefined') {
    return { status: 'idle' }
  }

  const currentUrl = new URL(window.location.href)
  const code = currentUrl.searchParams.get('code')?.trim() ?? ''
  const error = currentUrl.searchParams.get('error')?.trim() ?? ''
  const errorDescription = currentUrl.searchParams.get('error_description')?.trim() ?? ''

  if (!code && !error) {
    return { status: 'idle' }
  }

  try {
    if (error) {
      return {
        status: 'error',
        message: errorDescription || `OpenRouter OAuth failed: ${error}.`,
      }
    }

    const state = loadOauthState()
    if (!state?.codeVerifier) {
      return {
        status: 'error',
        message: 'OpenRouter OAuth callback was received, but the PKCE session is missing. Start the connection again.',
      }
    }

    const response = await fetch(OPENROUTER_AUTH_KEYS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        code,
        code_verifier: state.codeVerifier,
        code_challenge_method: OPENROUTER_CODE_CHALLENGE_METHOD,
      }),
    })

    const payload = await safeReadJson(response)
    if (!response.ok) {
      const detail = extractErrorMessage(payload) || `OpenRouter OAuth exchange failed with HTTP ${response.status}.`
      return {
        status: 'error',
        message: detail,
      }
    }

    const key = typeof payload?.key === 'string' ? payload.key.trim() : ''
    if (!key) {
      return {
        status: 'error',
        message: 'OpenRouter OAuth succeeded, but no API key was returned.',
      }
    }

    return {
      status: 'success',
      key,
    }
  } finally {
    clearOauthState()
    clearOauthParamsFromUrl()
  }
}

function createCallbackUrl(): string {
  const { origin, pathname } = window.location
  return `${origin}${pathname}#/`
}

function saveOauthState(state: OpenRouterOauthState): void {
  window.sessionStorage.setItem(OPENROUTER_OAUTH_STATE_STORAGE_KEY, JSON.stringify(state))
}

function loadOauthState(): OpenRouterOauthState | null {
  try {
    const raw = window.sessionStorage.getItem(OPENROUTER_OAUTH_STATE_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<OpenRouterOauthState>
    return typeof parsed.codeVerifier === 'string' && parsed.codeVerifier.trim()
      ? {
        codeVerifier: parsed.codeVerifier.trim(),
        createdAtMs: typeof parsed.createdAtMs === 'number' ? parsed.createdAtMs : 0,
      }
      : null
  } catch {
    return null
  }
}

function clearOauthState(): void {
  window.sessionStorage.removeItem(OPENROUTER_OAUTH_STATE_STORAGE_KEY)
}

function clearOauthParamsFromUrl(): void {
  const currentUrl = new URL(window.location.href)
  currentUrl.searchParams.delete('code')
  currentUrl.searchParams.delete('error')
  currentUrl.searchParams.delete('error_description')
  const search = currentUrl.searchParams.toString()
  const nextUrl = `${currentUrl.pathname}${search ? `?${search}` : ''}${currentUrl.hash}`
  window.history.replaceState({}, document.title, nextUrl)
}

function createCodeVerifier(): string {
  const bytes = new Uint8Array(32)
  window.crypto.getRandomValues(bytes)
  return encodeBase64Url(bytes)
}

async function createCodeChallenge(codeVerifier: string): Promise<string> {
  const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier))
  return encodeBase64Url(new Uint8Array(digest))
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
    .replace(/=+$/u, '')
}

async function safeReadJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    return await response.json() as Record<string, unknown>
  } catch {
    return null
  }
}

function extractErrorMessage(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null

  const message = typeof payload.error === 'string'
    ? payload.error
    : typeof payload.message === 'string'
      ? payload.message
      : null

  return message?.trim() || null
}
