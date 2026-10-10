// Thin fetch wrapper. All maths happens on the server; the client only displays results.
const TOKEN_KEY = 'fc27.token'

export class ApiError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* storage unavailable: session lasts for this tab only */
  }
}

let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn
}

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? ''

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  let body = init.body
  if (init.json !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(init.json)
  }
  let res: Response
  try {
    res = await fetch(`${BASE}/api${path}`, { ...init, headers: { ...headers, ...(init.headers as object) }, body })
  } catch {
    throw new ApiError(0, 'network', 'Cannot reach the FC 27 Market Engine server. Is the backend running?')
  }
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const detail = data?.detail
    const code = typeof detail === 'object' && detail ? detail.code : 'error'
    const message = typeof detail === 'object' && detail ? detail.message : typeof detail === 'string' ? detail : `Request failed (${res.status})`
    if (res.status === 401 && onUnauthorized) onUnauthorized()
    throw new ApiError(res.status, code, message)
  }
  return data as T
}

export function newRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID().replace(/-/g, '')
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
}
