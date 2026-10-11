import { useCallback, useState } from 'react'
import { Radar } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { useApi } from '../lib/useApi'
import { ago, coins, parseCoins, pct, pnlClass, signedCoins } from '../lib/format'
import type { Opportunity, Signal, SignalRow } from '../lib/types'
import { Button, Card, CoinInput, EmptyState, ErrorBox, Field, Notice, PageHeader, SignalBadge, SourceBadge, Spinner, useToast, cx } from '../components/ui'
import OpportunityCard from '../components/OpportunityCard'
import DealFinder from '../components/DealFinder'
import { BuyDialog, type BuyTarget } from '../components/TradeDialogs'
import { announceChange, useRefreshSignal } from '../components/Layout'

const SIGNALS: (Signal | 'ALL')[] = ['ALL', 'BUY', 'SELL', 'HOLD', 'WATCH', 'RISK']

export default function Scanner() {
  const toast = useToast()
  const [results, setResults] = useState<Opportunity[] | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<ApiError | null>(null)
  const [filter, setFilter] = useState<Signal | 'ALL'>('ALL')
  const [buy, setBuy] = useState<BuyTarget | null>(null)
  const signals = useApi<SignalRow[]>('/scanner/signals?limit=30')
  useRefreshSignal(useCallback(() => void signals.reload(), [signals.reload]))

  // manual evaluation form
  const [f, setF] = useState({ name: 'Meta Gold Winger', current: '25200', low: '25000', high: '32000', sell: '', history: '', threshold: '', minProfit: '', minRoi: '' })
  const [manual, setManual] = useState<Opportunity | null>(null)
  const [manualBusy, setManualBusy] = useState(false)
  const [manualError, setManualError] = useState<ApiError | null>(null)
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }))

  async function scan() {
    setScanning(true)
    setScanError(null)
    try {
      const r = await api<Opportunity[]>('/scanner/scan', { method: 'POST' })
      setResults(r)
      announceChange()
      toast('info', `Scanned ${r.length} watchlist player${r.length === 1 ? '' : 's'}: ${r.filter((o) => o.signal === 'BUY').length} BUY signal(s).`)
    } catch (e) {
      setScanError(e as ApiError)
    } finally {
      setScanning(false)
    }
  }

  async function evaluate(e: React.FormEvent) {
    e.preventDefault()
    setManualBusy(true)
    setManualError(null)
    const history = f.history.trim() ? f.history.split(/[\s,;]+/).filter(Boolean).map((x) => parseInt(x, 10)) : undefined
    if (history?.some((x) => !Number.isFinite(x) || x <= 0)) {
      setManualError(new ApiError(422, 'invalid_history', 'Price history must be positive whole numbers separated by spaces or new lines.'))
      setManualBusy(false)
      return
    }
    try {
      const r = await api<Opportunity>('/scanner/evaluate', {
        method: 'POST',
        json: {
          player_name: f.name,
          current_price: parseCoins(f.current),
          historical_low: parseCoins(f.low),
          historical_high: parseCoins(f.high),
          expected_sell_price: parseCoins(f.sell) ?? undefined,
          price_history: history,
          max_buy_threshold_pct: f.threshold ? parseFloat(f.threshold) : undefined,
          min_profit: f.minProfit ? parseCoins(f.minProfit) : undefined,
          min_roi_pct: f.minRoi ? parseFloat(f.minRoi) : undefined,
        },
      })
      setManual(r)
      announceChange()
    } catch (err) {
      setManualError(err as ApiError)
    } finally {
      setManualBusy(false)
    }
  }

  const visible = results?.filter((r) => filter === 'ALL' || r.signal === filter) ?? []
  const onBuy = (o: Opportunity) => setBuy({ cardId: o.card?.id, playerName: o.player_name, price: o.current_price, targetSell: o.expected_sell_price, isSimulatedData: o.is_simulated })

  return (
    <>
      <PageHeader
        title="Market Scanner"
        subtitle="evaluate_opportunity(): BUY only when the price is within your entry threshold of the historical low and estimated profit and ROI after 5% tax both meet your minimums."
        actions={<Button variant="primary" onClick={scan} loading={scanning}><Radar className="h-4 w-4" /> Scan watchlist</Button>}
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <DealFinder />
          <Card
            title="Watchlist scan"
            subtitle="Uses stored prices: historical low/high over the last 30 days"
            actions={
              <div role="tablist" aria-label="Filter by signal" className="flex flex-wrap gap-1">
                {SIGNALS.map((s) => (
                  <button key={s} role="tab" aria-selected={filter === s} onClick={() => setFilter(s)}
                    className={cx('rounded-md px-2 py-1 text-xs', filter === s ? 'bg-panel-3 text-ink' : 'text-ink-muted hover:text-ink')}>
                    {s}{results ? ` ${s === 'ALL' ? results.length : results.filter((r) => r.signal === s).length}` : ''}
                  </button>
                ))}
              </div>
            }
          >
            <ErrorBox error={scanError} onRetry={scan} />
            {scanning && !results ? <Spinner label="Scanning…" /> : !results ? (
              <EmptyState icon={<Radar className="h-8 w-8" />} title="Run a scan" action={<Button variant="primary" onClick={scan}>Scan watchlist</Button>}>
                Evaluates every watchlist player and records each signal in the signal log.
              </EmptyState>
            ) : visible.length ? (
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{visible.map((o) => <OpportunityCard key={o.watchlist_id ?? o.player_name} opp={o} onBuy={onBuy} />)}</div>
            ) : <EmptyState title={`No ${filter} signals`} />}
          </Card>

          <Card title="Signal log" subtitle="Every recorded evaluation">
            {signals.loading && !signals.data ? <Spinner /> : signals.data?.length ? (
              <div className="-mx-4 overflow-x-auto">
                <table className="w-full">
                  <thead><tr className="border-b border-line"><th className="th">When</th><th className="th">Player</th><th className="th">Signal</th><th className="th text-right">Price</th><th className="th text-right">Est. profit</th><th className="th text-right">ROI</th><th className="th">Data</th></tr></thead>
                  <tbody>
                    {signals.data.map((s) => (
                      <tr key={s.id} className="border-b border-line/60 last:border-0" title={s.explanation ?? ''}>
                        <td className="td text-ink-muted">{ago(s.created_at)}</td>
                        <td className="td">{s.player_name}</td>
                        <td className="td"><SignalBadge signal={s.signal} /></td>
                        <td className="td num text-right">{coins(s.current_price)}</td>
                        <td className={cx('td num text-right', pnlClass(s.estimated_profit))}>{signedCoins(s.estimated_profit)}</td>
                        <td className={cx('td num text-right', pnlClass(s.roi_pct))}>{pct(s.roi_pct)}</td>
                        <td className="td"><SourceBadge source={s.data_source} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <EmptyState title="No signals recorded yet" />}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Manual evaluation" subtitle="Type prices in directly; thresholds here override your settings for this run only">
            <form className="space-y-3" onSubmit={evaluate}>
              <ErrorBox error={manualError} />
              <Field label="Player name">{(id) => <input id={id} className="input" value={f.name} onChange={(e) => set('name')(e.target.value)} required />}</Field>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Buy-now">{(id) => <CoinInput id={id} value={f.current} onChange={set('current')} required />}</Field>
                <Field label="Hist. low">{(id) => <CoinInput id={id} value={f.low} onChange={set('low')} required />}</Field>
                <Field label="Hist. high">{(id) => <CoinInput id={id} value={f.high} onChange={set('high')} required />}</Field>
              </div>
              <Field label="Expected sell price" hint="Defaults to the historical high">{(id) => <CoinInput id={id} value={f.sell} onChange={set('sell')} placeholder="optional" />}</Field>
              <Field label="Recent price history" hint="Optional — used to detect unreliable, volatile prices">
                {(id) => <textarea id={id} className="input num h-16" value={f.history} onChange={(e) => set('history')(e.target.value)} placeholder="25000 26500 27100 …" />}
              </Field>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Max entry %">{(id) => <input id={id} className="input num" inputMode="decimal" value={f.threshold} onChange={(e) => set('threshold')(e.target.value)} placeholder="102" />}</Field>
                <Field label="Min profit">{(id) => <CoinInput id={id} value={f.minProfit} onChange={set('minProfit')} placeholder="1,000" />}</Field>
                <Field label="Min ROI %">{(id) => <input id={id} className="input num" inputMode="decimal" value={f.minRoi} onChange={(e) => set('minRoi')(e.target.value)} placeholder="0" />}</Field>
              </div>
              <Button type="submit" variant="primary" className="w-full" loading={manualBusy}>Evaluate</Button>
            </form>
          </Card>
          {manual && <OpportunityCard opp={manual} onBuy={onBuy} />}
          <Notice>Manual inputs are labelled <strong>Manual</strong>. Signals are rules applied to the prices you supply; they are not predictions and never guarantee a profit.</Notice>
        </div>
      </div>
      <BuyDialog target={buy} onClose={() => setBuy(null)} onDone={() => void signals.reload()} />
    </>
  )
}
