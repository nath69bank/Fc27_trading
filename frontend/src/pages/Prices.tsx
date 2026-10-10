import { useCallback, useEffect, useState } from 'react'
import { CandlestickChart, FlaskConical, RefreshCw, Trash2, Upload } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { useApi } from '../lib/useApi'
import { ago, coins, dateTime, parseCoins } from '../lib/format'
import type { DataStatus, MarketCard, PricePoint } from '../lib/types'
import { Button, Card, CoinInput, ConfirmDialog, EmptyState, ErrorBox, Field, Notice, PageHeader, SourceBadge, Spinner, useToast, cx } from '../components/ui'
import { PriceHistoryChart } from '../components/charts'
import { DataModeIndicator, announceChange, useRefreshSignal } from '../components/Layout'

const SAMPLE_CSV = 'player_name,price,observed_at,platform\nMeta Gold Winger,25400,2026-10-10T09:00:00Z,cross\n'

export default function Prices() {
  const toast = useToast()
  const status = useApi<DataStatus>('/market/status')
  const cards = useApi<MarketCard[]>('/market/cards')
  const [selected, setSelected] = useState<string | null>(null)
  const prices = useApi<PricePoint[]>(selected ? `/market/prices?card_id=${selected}` : null)
  const reloadAll = useCallback(() => { void status.reload(); void cards.reload(); void prices.reload() }, [status.reload, cards.reload, prices.reload])
  useRefreshSignal(reloadAll)
  useEffect(() => {
    if (!selected && cards.data?.length) setSelected(cards.data[0].id)
  }, [cards.data, selected])

  const [manual, setManual] = useState({ name: '', price: '', when: '' })
  const [manualBusy, setManualBusy] = useState(false)
  const [manualError, setManualError] = useState<ApiError | null>(null)
  const [csv, setCsv] = useState('')
  const [csvBusy, setCsvBusy] = useState(false)
  const [csvResult, setCsvResult] = useState<{ imported: number; cards: number; error_count: number; errors: { row: number; error: string }[] } | null>(null)
  const [csvError, setCsvError] = useState<ApiError | null>(null)
  const [simBusy, setSimBusy] = useState(false)
  const [liveBusy, setLiveBusy] = useState(false)
  const [deleting, setDeleting] = useState<PricePoint | null>(null)
  const card = cards.data?.find((c) => c.id === selected)

  async function addManual(e: React.FormEvent) {
    e.preventDefault()
    const p = parseCoins(manual.price)
    if (!p) return
    setManualBusy(true)
    setManualError(null)
    try {
      const match = cards.data?.find((c) => c.player_name.toLowerCase() === manual.name.trim().toLowerCase())
      await api('/market/prices', {
        method: 'POST',
        json: { ...(match ? { card_id: match.id } : { player_name: manual.name.trim() }), price: p, observed_at: manual.when ? new Date(manual.when).toISOString() : undefined },
      })
      toast('success', `Recorded ${coins(p)} for ${manual.name}.`)
      setManual({ name: manual.name, price: '', when: '' })
      announceChange()
    } catch (err) {
      setManualError(err as ApiError)
    } finally {
      setManualBusy(false)
    }
  }

  async function importCsv() {
    setCsvBusy(true)
    setCsvError(null)
    setCsvResult(null)
    try {
      const r = await api<NonNullable<typeof csvResult>>('/market/import', { method: 'POST', json: { csv } })
      setCsvResult(r)
      toast(r.imported ? 'success' : 'info', `Imported ${r.imported} price${r.imported === 1 ? '' : 's'}${r.error_count ? `, ${r.error_count} row(s) skipped` : ''}.`)
      announceChange()
    } catch (err) {
      setCsvError(err as ApiError)
    } finally {
      setCsvBusy(false)
    }
  }

  async function simulate() {
    setSimBusy(true)
    try {
      const r = await api<{ created: number }>('/market/simulate', { method: 'POST' })
      toast('info', r.created ? `Added ${r.created} simulated price(s). These are not real market prices.` : 'Add watchlist players first — simulation moves their prices.')
      announceChange()
    } catch (err) {
      toast('error', (err as Error).message)
    } finally {
      setSimBusy(false)
    }
  }

  async function refreshLive() {
    setLiveBusy(true)
    try {
      const r = await api<{ updated: number }>('/market/refresh', { method: 'POST' })
      toast('success', `Live provider returned ${r.updated} price(s).`)
      announceChange()
    } catch (err) {
      toast('error', (err as Error).message)
    } finally {
      setLiveBusy(false)
    }
  }

  async function deletePrice() {
    if (!deleting) return
    try {
      await api(`/market/prices/${deleting.id}`, { method: 'DELETE' })
      toast('success', 'Observation deleted.')
      setDeleting(null)
      announceChange()
    } catch (err) {
      toast('error', (err as Error).message)
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > 2_000_000) return toast('error', 'CSV must be under 2 MB.')
    setCsv(await f.text())
  }

  const s = status.data
  return (
    <>
      <PageHeader title="Price History" subtitle="Every price is stored with its card, platform, timestamp and source. Nothing here is fetched from FC 27 unless you configure an authorised provider." />
      <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="card flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-sm">
          <DataModeIndicator status={s} compact />
          <span className="text-ink-muted">Last update: <span className="text-ink">{s?.last_updated ? `${dateTime(s.last_updated)} (${ago(s.last_updated)})` : 'none'}</span></span>
          <span className="text-ink-muted">Platform: <span className="capitalize text-ink">{s?.platform}</span></span>
          <span className="text-ink-muted">Live provider: <span className={s?.live_available ? 'text-profit' : 'text-ink'}>{s?.live_provider ?? 'not configured'}</span></span>
          {s && Object.entries(s.observations_by_source).map(([k, v]) => <span key={k} className="inline-flex items-center gap-1 text-ink-muted"><SourceBadge source={k} /> <span className="num">{v}</span></span>)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={simulate} loading={simBusy} title="Append a random-walk price for each watchlisted card, labelled Simulated"><FlaskConical className="h-4 w-4" /> Simulate market move</Button>
          <Button onClick={refreshLive} loading={liveBusy} disabled={!s?.live_available} title={s?.live_available ? 'Fetch from the configured provider' : 'Configure MARKET_DATA_PROVIDER to enable'}><RefreshCw className="h-4 w-4" /> Refresh live</Button>
        </div>
      </div>
      {s?.is_stale && s.mode !== 'none' && <div className="mb-4"><Notice tone="warn">Your latest price is older than {s.stale_after_hours}h. Stale data produces WATCH signals.</Notice></div>}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <Card title="Card price history" actions={cards.data?.length ? (
            <select className="input w-auto py-1.5" value={selected ?? ''} onChange={(e) => setSelected(e.target.value)} aria-label="Select card">
              {cards.data.map((c) => <option key={c.id} value={c.id}>{c.player_name}{c.version ? ` (${c.version})` : ''}</option>)}
            </select>
          ) : null}>
            <ErrorBox error={cards.error} onRetry={cards.reload} />
            {cards.loading && !cards.data ? <Spinner /> : !cards.data?.length ? (
              <EmptyState icon={<CandlestickChart className="h-8 w-8" />} title="No cards tracked yet">Add a watchlist player, enter a manual price or import a CSV.</EmptyState>
            ) : (
              <>
                {card && (
                  <div className="mb-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                    <div><p className="text-ink-muted">Latest</p><p className="num text-sm">{coins(card.stats.latest_price)}</p></div>
                    <div><p className="text-ink-muted">30-day low</p><p className="num text-sm">{coins(card.stats.historical_low)}</p></div>
                    <div><p className="text-ink-muted">30-day high</p><p className="num text-sm">{coins(card.stats.historical_high)}</p></div>
                    <div><p className="text-ink-muted">Freshness</p><p className={cx('text-sm', card.stats.is_stale ? 'text-warn' : 'text-ink')}>{card.stats.latest_at ? ago(card.stats.latest_at) : '—'}{card.stats.is_stale && ' · stale'}</p></div>
                  </div>
                )}
                <PriceHistoryChart points={prices.data ?? []} />
                <div className="-mx-4 mt-4 max-h-80 overflow-auto">
                  <table className="w-full">
                    <thead className="sticky top-0 bg-panel"><tr className="border-b border-line"><th className="th">Observed</th><th className="th text-right">Price</th><th className="th">Source</th><th className="th">Platform</th><th className="th"><span className="sr-only">Actions</span></th></tr></thead>
                    <tbody>
                      {prices.data?.map((p) => (
                        <tr key={p.id} className="border-b border-line/60">
                          <td className="td text-ink-muted">{dateTime(p.observed_at)}</td>
                          <td className="td num text-right">{coins(p.price)}</td>
                          <td className="td"><SourceBadge source={p.source} /></td>
                          <td className="td text-xs capitalize text-ink-muted">{p.platform}</td>
                          <td className="td text-right">{p.source !== 'live' && <Button size="sm" variant="ghost" onClick={() => setDeleting(p)} aria-label="Delete observation"><Trash2 className="h-3.5 w-3.5" /></Button>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Manual price entry" subtitle="e.g. the lowest buy-now you can see in-game">
            <form onSubmit={addManual} className="space-y-3">
              <ErrorBox error={manualError} />
              <Field label="Player">{(id) => (<><input id={id} className="input" list="price-cards" value={manual.name} onChange={(e) => setManual({ ...manual, name: e.target.value })} required /><datalist id="price-cards">{cards.data?.map((c) => <option key={c.id} value={c.player_name} />)}</datalist></>)}</Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Price">{(id) => <CoinInput id={id} value={manual.price} onChange={(v) => setManual({ ...manual, price: v })} required />}</Field>
                <Field label="Observed at" hint="Blank = now">{(id) => <input id={id} type="datetime-local" className="input" value={manual.when} onChange={(e) => setManual({ ...manual, when: e.target.value })} />}</Field>
              </div>
              <Button type="submit" variant="primary" className="w-full" loading={manualBusy}>Record price</Button>
            </form>
          </Card>
          <Card title="CSV import" subtitle="Columns: player_name, price · optional observed_at, platform, version, rating">
            <div className="space-y-3">
              <ErrorBox error={csvError} />
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong px-3 py-3 text-sm text-ink-muted hover:border-info hover:text-ink">
                <Upload className="h-4 w-4" /> Choose a .csv file
                <input type="file" accept=".csv,text/csv" className="sr-only" onChange={onFile} />
              </label>
              <textarea className="input num h-28 text-xs" value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={SAMPLE_CSV} aria-label="CSV contents" />
              <div className="flex gap-2">
                <Button variant="primary" className="flex-1" onClick={importCsv} loading={csvBusy} disabled={!csv.trim()}>Import</Button>
                <Button variant="ghost" onClick={() => setCsv(SAMPLE_CSV)}>Example</Button>
              </div>
              {csvResult && (
                <div className="rounded-lg border border-line bg-panel-2 p-3 text-xs">
                  <p>Imported <strong className="num">{csvResult.imported}</strong> price(s) across {csvResult.cards} card(s). {csvResult.error_count > 0 && <span className="text-warn">{csvResult.error_count} row(s) skipped.</span>}</p>
                  {csvResult.errors.length > 0 && <ul className="mt-2 max-h-28 space-y-0.5 overflow-auto text-loss">{csvResult.errors.map((e) => <li key={e.row}>Row {e.row}: {e.error}</li>)}</ul>}
                </div>
              )}
            </div>
          </Card>
          <Notice>Simulated and demo sample prices are always labelled. To use real-time data you need an authorised provider — see docs/MARKET_DATA.md.</Notice>
        </div>
      </div>
      <ConfirmDialog open={Boolean(deleting)} danger title="Delete this observation?" confirmLabel="Delete" onClose={() => setDeleting(null)} onConfirm={deletePrice}
        message={<>Delete the {deleting?.source} price of <span className="num text-ink">{coins(deleting?.price)}</span> from {dateTime(deleting?.observed_at)}? Signals will be recalculated.</>} />
    </>
  )
}
