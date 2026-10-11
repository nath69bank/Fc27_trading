import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { useApi } from '../lib/useApi'
import { coins, dateTime, parseCoins, signedCoins, pnlClass } from '../lib/format'
import type { BalanceEvent, Settings } from '../lib/types'
import { Button, Card, CoinInput, ConfirmDialog, ErrorBox, Field, Notice, PageHeader, Spinner, useToast, cx } from '../components/ui'
import { announceChange, useRefreshSignal } from '../components/Layout'

const ALERTS: [string, string][] = [
  ['below_target_buy', 'Watchlisted player at or below target buy'],
  ['target_sell_reached', 'Player or transfer reaches target sell'],
  ['profit_threshold', 'Estimated profit exceeds your threshold (BUY signal)'],
  ['holding_limit', 'Transfer approaching holding-time limit'],
  ['stale_data', 'Market data becomes stale'],
  ['exposure_limit', 'Approaching portfolio exposure limit'],
]

type Form = Record<string, string>
const toForm = (s: Settings): Form => ({
  starting_coins: String(s.starting_coins), tax_rate_pct: String(s.tax_rate_pct), min_profit: String(s.min_profit), min_roi_pct: String(s.min_roi_pct),
  entry_threshold_pct: String(s.entry_threshold_pct), max_investment_per_card: String(s.max_investment_per_card), max_portfolio_exposure: String(s.max_portfolio_exposure),
  exposure_warning_pct: String(s.exposure_warning_pct), default_sell_strategy: s.default_sell_strategy, platform: s.platform, stale_after_hours: String(s.stale_after_hours),
  refresh_minutes: String(s.refresh_minutes), holding_limit_hours: String(s.holding_limit_hours), max_volatility_pct: String(s.max_volatility_pct), mode: s.mode,
})

export default function SettingsPage() {
  const toast = useToast()
  const { data, error, loading, reload, setData } = useApi<Settings>('/settings')
  const events = useApi<BalanceEvent[]>('/account/events?limit=50')
  useRefreshSignal(useCallback(() => void events.reload(), [events.reload]))
  const [f, setF] = useState<Form>({})
  const [prefs, setPrefs] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<ApiError | null>(null)
  const [adj, setAdj] = useState({ amount: '', direction: 'add', reason: '' })
  const [adjConfirm, setAdjConfirm] = useState(false)
  const [adjBusy, setAdjBusy] = useState(false)
  const [adjError, setAdjError] = useState<ApiError | null>(null)

  useEffect(() => {
    if (data) {
      setF(toForm(data))
      setPrefs(data.alert_prefs)
    }
  }, [data])

  const set = (k: string) => (v: string) => setF((s) => ({ ...s, [k]: v }))
  const num = (k: string) => (f[k] === '' || f[k] == null ? undefined : Number(f[k].replace(/,/g, '')))

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setSaveError(null)
    try {
      const body = {
        starting_coins: num('starting_coins'), tax_rate_pct: num('tax_rate_pct'), min_profit: num('min_profit'), min_roi_pct: num('min_roi_pct'),
        entry_threshold_pct: num('entry_threshold_pct'), max_investment_per_card: num('max_investment_per_card'), max_portfolio_exposure: num('max_portfolio_exposure'),
        exposure_warning_pct: num('exposure_warning_pct'), default_sell_strategy: f.default_sell_strategy, platform: f.platform, stale_after_hours: num('stale_after_hours'),
        refresh_minutes: num('refresh_minutes'), holding_limit_hours: num('holding_limit_hours'), max_volatility_pct: num('max_volatility_pct'), mode: f.mode, alert_prefs: prefs,
      }
      setData(await api<Settings>('/settings', { method: 'PUT', json: body }))
      toast('success', 'Settings saved. Signals now use the new rules.')
      announceChange()
    } catch (err) {
      setSaveError(err as ApiError)
    } finally {
      setBusy(false)
    }
  }

  const adjAmount = (parseCoins(adj.amount) ?? 0) * (adj.direction === 'add' ? 1 : -1)
  async function adjust() {
    setAdjBusy(true)
    setAdjError(null)
    try {
      await api('/account/adjustments', { method: 'POST', json: { amount: adjAmount, reason: adj.reason } })
      toast('success', `Balance adjusted by ${signedCoins(adjAmount)} coins.`)
      setAdj({ amount: '', direction: 'add', reason: '' })
      setAdjConfirm(false)
      announceChange()
    } catch (err) {
      setAdjError(err as ApiError)
      setAdjConfirm(false)
    } finally {
      setAdjBusy(false)
    }
  }

  if (loading && !data) return <Spinner />
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />
  const input = (k: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (id: string) => <input id={id} className="input num" inputMode="decimal" value={f[k] ?? ''} onChange={(e) => set(k)(e.target.value)} {...props} />

  return (
    <>
      <PageHeader title="Settings" subtitle={data ? `Last saved ${dateTime(data.updated_at)}` : undefined} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <form onSubmit={save} className="space-y-4">
          <ErrorBox error={saveError} />
          <Card title="Trading mode">
            <div className="grid gap-3 sm:grid-cols-2">
              {(['simulation', 'manual'] as const).map((m) => (
                <label key={m} className={cx('cursor-pointer rounded-lg border p-3 text-sm', f.mode === m ? (m === 'simulation' ? 'border-gold/60 bg-gold/5' : 'border-info/60 bg-info/5') : 'border-line hover:border-line-strong')}>
                  <input type="radio" name="mode" value={m} checked={f.mode === m} onChange={() => set('mode')(m)} className="sr-only" />
                  <p className="font-medium">{m === 'simulation' ? 'Simulation mode' : 'Manual tracking mode'}</p>
                  <p className="mt-1 text-xs text-ink-muted">{m === 'simulation' ? 'All purchases and sales are virtual transactions with practice coins.' : 'Record real trades you made in FC 27 yourself. The app never places transfers.'}</p>
                </label>
              ))}
            </div>
          </Card>
          <Card title="Signal rules" subtitle="Used by evaluate_opportunity() everywhere">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Transfer tax %" hint="Default 5%">{input('tax_rate_pct')}</Field>
              <Field label="Entry threshold %" hint="Max price vs historical low (102%)">{input('entry_threshold_pct')}</Field>
              <Field label="Minimum profit" hint="Coins after tax (1,000)">{input('min_profit')}</Field>
              <Field label="Minimum ROI %">{input('min_roi_pct')}</Field>
              <Field label="Max volatility %" hint="Above this, signal is RISK">{input('max_volatility_pct')}</Field>
              <Field label="Default selling strategy">
                {(id) => (
                  <select id={id} className="input" value={f.default_sell_strategy} onChange={(e) => set('default_sell_strategy')(e.target.value)}>
                    <option value="target_price">Your target sell price</option>
                    <option value="historical_high">30-day historical high</option>
                    <option value="quick_flip">Quick flip (mid-range)</option>
                  </select>
                )}
              </Field>
            </div>
          </Card>
          <Card title="Risk limits">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Max investment per card" hint="Coins in one card across open transfers">{input('max_investment_per_card')}</Field>
              <Field label="Max portfolio exposure" hint="Total invested coins">{input('max_portfolio_exposure')}</Field>
              <Field label="Exposure warning at %">{input('exposure_warning_pct')}</Field>
              <Field label="Holding-time limit (hours)">{input('holding_limit_hours')}</Field>
            </div>
          </Card>
          <Card title="Market data">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Market" hint="Xbox and PlayStation share one console market">
                {(id) => (
                  <select id={id} className="input" value={f.platform} onChange={(e) => set('platform')(e.target.value)}>
                    <option value="console">Console (Xbox &amp; PlayStation)</option><option value="pc">PC</option>
                  </select>
                )}
              </Field>
              <Field label="Stale after (hours)">{input('stale_after_hours')}</Field>
              <Field label="Refresh every (minutes)" hint="Used by a configured live provider">{input('refresh_minutes')}</Field>
            </div>
          </Card>
          <Card title="Alerts" subtitle="In-app notifications only — no push or email service is configured">
            <ul className="space-y-2">
              {ALERTS.map(([k, label]) => (
                <li key={k}>
                  <label className="flex items-center justify-between gap-3 text-sm">
                    {label}
                    <input type="checkbox" role="switch" checked={prefs[k] ?? true} onChange={(e) => setPrefs({ ...prefs, [k]: e.target.checked })} className="h-4 w-4 accent-[#2bd576]" />
                  </label>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Starting coin balance">
            <Field label="Starting coins (reference)" hint="Changing this does not alter your balance or history. Use a balance adjustment to move coins.">{input('starting_coins')}</Field>
          </Card>
          <div className="sticky bottom-3 flex justify-end"><Button type="submit" variant="primary" loading={busy}>Save settings</Button></div>
        </form>

        <div className="space-y-4">
          <Card title="Balance adjustment" subtitle="Auditable: every adjustment is journaled with its reason">
            <div className="space-y-3">
              <ErrorBox error={adjError} />
              <div className="grid grid-cols-[auto_1fr] gap-2">
                <Field label="Direction">{(id) => <select id={id} className="input" value={adj.direction} onChange={(e) => setAdj({ ...adj, direction: e.target.value })}><option value="add">Add</option><option value="remove">Remove</option></select>}</Field>
                <Field label="Coins">{(id) => <CoinInput id={id} value={adj.amount} onChange={(v) => setAdj({ ...adj, amount: v })} />}</Field>
              </div>
              <Field label="Reason">{(id) => <input id={id} className="input" value={adj.reason} maxLength={500} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} placeholder="e.g. Coins from objectives" />}</Field>
              <Button className="w-full" onClick={() => setAdjConfirm(true)} disabled={!adjAmount || adj.reason.trim().length < 3}>Review adjustment</Button>
            </div>
          </Card>
          <Card title="Balance audit log">
            {events.loading && !events.data ? <Spinner /> : (
              <ul className="max-h-[520px] divide-y divide-line overflow-auto">
                {events.data?.map((e) => (
                  <li key={e.id} className="py-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium capitalize text-ink">{e.kind}</span>
                      <span className={cx('num', pnlClass(e.available_delta))}>{signedCoins(e.available_delta)}</span>
                    </div>
                    <p className="text-ink-muted">{e.reason}</p>
                    <p className="text-ink-faint">{dateTime(e.created_at)} · available {coins(e.available_after)} · invested {coins(e.invested_after)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Notice>Profits, tax and balances are always recalculated on the server; the browser never submits them.</Notice>
        </div>
      </div>
      <ConfirmDialog open={adjConfirm} title="Confirm balance adjustment" confirmLabel="Apply adjustment" busy={adjBusy} onClose={() => setAdjConfirm(false)} onConfirm={adjust}
        message={<>Adjust available coins by <span className={cx('num font-semibold', pnlClass(adjAmount))}>{signedCoins(adjAmount)}</span>? Reason: “{adj.reason}”. This is permanently recorded in the audit log.</>} />
    </>
  )
}
