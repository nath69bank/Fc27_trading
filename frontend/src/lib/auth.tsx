import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, ApiError, getToken, setToken, setUnauthorizedHandler } from './api'

interface User {
  id: string
  username: string
  is_demo: boolean
}
interface AuthState {
  user: User | null
  ready: boolean
  error: ApiError | null
  retry: () => void
  /** Throw away this browser's desk and open a fresh one. */
  startOver: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

/**
 * The site is open: there is no login screen. On a visitor's first visit the browser opens a
 * private guest desk (POST /auth/demo) and keeps its token, so the same browser returns to the
 * same coins and trades, and visitors never see each other's data.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const opening = useRef<Promise<void> | null>(null)

  const openDesk = useCallback(() => {
    // One request at a time, even under React StrictMode's double effects.
    if (opening.current) return opening.current
    opening.current = (async () => {
      setError(null)
      try {
        if (getToken()) {
          try {
            setUser(await api<User>('/auth/me'))
            return
          } catch (e) {
            if (!(e instanceof ApiError) || e.status !== 401) throw e
            setToken(null) // expired or removed: open a new desk below
          }
        }
        const r = await api<{ token: string; user: User }>('/auth/demo', { method: 'POST' })
        setToken(r.token)
        setUser(r.user)
      } catch (e) {
        setError(e instanceof ApiError ? e : new ApiError(0, 'error', String(e)))
      } finally {
        setReady(true)
        opening.current = null
      }
    })()
    return opening.current
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setToken(null)
      setUser(null)
      void openDesk()
    })
    void openDesk()
  }, [openDesk])

  const value = useMemo<AuthState>(
    () => ({
      user,
      ready,
      error,
      retry: () => void openDesk(),
      startOver: async () => {
        try {
          await api('/auth/logout', { method: 'POST' })
        } catch {
          /* the old desk is abandoned either way */
        }
        setToken(null)
        setUser(null)
        await openDesk()
      },
    }),
    [user, ready, error, openDesk],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}
