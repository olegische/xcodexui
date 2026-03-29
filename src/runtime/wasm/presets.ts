import type { BrowserSecurityConfig, RuntimeMode } from 'xcodex-runtime/types'
import { getRuntimeModePresentation, listRuntimeModes } from './runtimeModes'

export type WasmRuntimePolicyPreset = {
  runtimeMode: RuntimeMode
  label: string
  description: string
  browserSecurity: Required<BrowserSecurityConfig>
}

type OriginPolicy = {
  origin: string | null
  allowLocalhost: boolean
  allowPrivateNetwork: boolean
}

function parseAppOrigin(): OriginPolicy {
  if (typeof window === 'undefined') {
    return {
      origin: null,
      allowLocalhost: false,
      allowPrivateNetwork: false,
    }
  }

  try {
    const origin = window.location.origin
    const hostname = window.location.hostname.toLowerCase()
    return {
      origin,
      allowLocalhost: isLocalhostHostname(hostname),
      allowPrivateNetwork: isPrivateNetworkHostname(hostname),
    }
  } catch {
    return {
      origin: null,
      allowLocalhost: false,
      allowPrivateNetwork: false,
    }
  }
}

function isLocalhostHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

function isPrivateNetworkHostname(hostname: string): boolean {
  if (isLocalhostHostname(hostname)) return false
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    const normalized = hostname.slice(1, -1).toLowerCase()
    return normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:')
  }
  if (!/^\d{1,3}(\.\d{1,3}){3}$/u.test(hostname)) return false
  const octets = hostname.split('.').map(Number)
  const [first, second] = octets
  if (octets.some((octet) => Number.isNaN(octet) || octet < 0 || octet > 255)) return false
  return first === 10
    || (first === 192 && second === 168)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 169 && second === 254)
  }

function createBrowserSecurityPreset(): Required<BrowserSecurityConfig> {
  const policy = parseAppOrigin()
  return {
    allowed_origins: policy.origin ? [policy.origin] : [],
    allow_localhost: policy.allowLocalhost,
    allow_private_network: policy.allowPrivateNetwork,
  }
}

export function getWasmRuntimePolicyPreset(runtimeMode: RuntimeMode): WasmRuntimePolicyPreset {
  const browserSecurity = createBrowserSecurityPreset()
  const presentation = getRuntimeModePresentation(runtimeMode)
  return {
    runtimeMode: presentation.runtimeMode,
    label: presentation.label,
    description: presentation.description,
    browserSecurity,
  }
}

export function listWasmRuntimePolicyPresets(): WasmRuntimePolicyPreset[] {
  return listRuntimeModes().map((runtimeMode) => getWasmRuntimePolicyPreset(runtimeMode))
}
