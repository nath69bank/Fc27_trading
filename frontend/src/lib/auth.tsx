import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, getToken, setToken, setUnauthorizedHandler } from './api'

interface User {
  id: string
  username: string
  is_demo: boolean
}
interface AuthState {
  user: User | null
  ready: boolean
  login: (username: string, password: string) => Promise<void>
  register: (username: string, password: string) => Promise<void>
  startDemo: () => Promise<void>
  logout: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setToken(null)
      setUser(null)
    })
    if (!getToken()) {
      setReady(true)
      return
    }
    api<User>('/auth/me')
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setReady(true))
  }, [])

  const accept = useCallback((r: { token: string; user: User }) => {
    setToken(r.token)
    setUser(r.user)
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      user,
      ready,
      login: async (username, password) => accept(await api('/auth/login', { method: 'POST', json: { username, password } })),
      register: async (username, password) => accept(await api('/auth/register', { method: 'POST', json: { username, password } })),
      startDemo: async () => accept(await api('/auth/demo', { method: 'POST' })),
      logout: async () => {
        try {
          await api('/auth/logout', { method: 'POST' })
        } finally {
          setToken(null)
          setUser(null)
        }
      },
    }),
    [user, ready, accept],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}
