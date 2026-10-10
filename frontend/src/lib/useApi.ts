import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from './api'

export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(Boolean(path))
  const seq = useRef(0)

  const load = useCallback(async () => {
    if (!path) return
    const id = ++seq.current
    setLoading(true)
    try {
      const result = await api<T>(path)
      if (id === seq.current) {
        setData(result)
        setError(null)
      }
    } catch (e) {
      if (id === seq.current) setError(e instanceof ApiError ? e : new ApiError(0, 'error', String(e)))
    } finally {
      if (id === seq.current) setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps])

  useEffect(() => {
    void load()
  }, [load])

  return { data, error, loading, reload: load, setData }
}
