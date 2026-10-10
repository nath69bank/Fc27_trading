import { useEffect, useState } from 'react'
import { FlaskConical } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { Button, ErrorBox, Field } from '../components/ui'

export default function Login() {
  const { login, register, startDemo } = useAuth()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<'form' | 'demo' | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [options, setOptions] = useState({ registration: true, demo_signup: true })

  useEffect(() => {
    api<typeof options>('/auth/options').then(setOptions).catch((e) => setError(e))
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy('form')
    setError(null)
    try {
      await (mode === 'login' ? login(username, password) : register(username, password))
    } catch (err) {
      setError(err as ApiError)
    } finally {
      setBusy(null)
    }
  }

  async function demo() {
    setBusy('demo')
    setError(null)
    try {
      await startDemo()
    } catch (err) {
      setError(err as ApiError)
      setBusy(null)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <img src="/favicon.svg" alt="" className="mx-auto mb-4 h-12 w-12" />
          <h1 className="text-2xl font-bold tracking-tight">FC 27 Market Engine</h1>
          <p className="mt-1 text-sm uppercase tracking-[0.18em] text-gold">Trade Smarter. Track Every Coin.</p>
        </div>
        <div className="card p-6">
          {options.demo_signup && (
            <>
              <Button variant="gold" className="w-full" onClick={demo} loading={busy === 'demo'}>
                <FlaskConical className="h-4 w-4" aria-hidden /> Try the demo account
              </Button>
              <p className="mt-2 text-center text-xs text-ink-muted">A private, freshly seeded demo with 150,000 virtual coins and sample prices.</p>
              <div className="my-5 flex items-center gap-3 text-xs text-ink-faint"><span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" /></div>
            </>
          )}
          <form onSubmit={submit} className="space-y-4">
            <ErrorBox error={error} />
            <Field label="Username">{(id) => <input id={id} className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required minLength={3} />}</Field>
            <Field label="Password" hint={mode === 'register' ? 'At least 8 characters' : undefined}>
              {(id) => <input id={id} className="input" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />}
            </Field>
            <Button type="submit" variant="primary" className="w-full" loading={busy === 'form'}>{mode === 'login' ? 'Sign in' : 'Create account'}</Button>
          </form>
          {options.registration && (
            <p className="mt-4 text-center text-sm text-ink-muted">
              {mode === 'login' ? 'New here?' : 'Already have an account?'}{' '}
              <button className="font-medium text-info hover:underline" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null) }}>
                {mode === 'login' ? 'Create an account' : 'Sign in'}
              </button>
            </p>
          )}
        </div>
        <p className="mt-6 text-center text-xs leading-relaxed text-ink-faint">
          Unofficial analytics tool, not affiliated with EA SPORTS. No live FC 27 prices are assumed: data is manual, imported, simulated, or from a provider you configure. Estimates are never guaranteed.
        </p>
      </div>
    </main>
  )
}
