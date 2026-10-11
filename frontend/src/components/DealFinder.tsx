import { useCallback, useEffect, useRef, useState } from 'react'
import { Pause, Play, RefreshCw, ShoppingCart } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { ago, coins, pct, pnlClass, signedCoins } from '../lib/format'
import type { DealRow, Deals } from '../lib/types'
import { Badge, Button, Card, EmptyState, ErrorBox, SignalBadge, SourceBadge, useToast, cx } from './ui'
import { SEEN_ON_LABEL } from './CardTools'
import { BuyDialog, type BuyTarget } from './TradeDialogs'
import { useRefreshSignal } from './Layout'

const INTERVALS = [
  { s: 30, label: '30s' },
  { s: 60, label: '1 min' },
  { s: 120, label: '2 min' },
  { s: 300, label: '5 min' },
]
const PREF_KEY = 'fc27.dealfinder'

function loadPref(): { auto: boolean; every: number } {
  try {
    const v = JSON.parse(localStorage.getItem(PREF_KEY) ?? '')
    if (typeof v?.auto === 'boolean' && INTERVALS.some((i) => i.s === v.every)) return v
  } catch {
    /* no saved preference */
  }
  return { auto: true, every: 60 }
}

function DealLine({ d, kind, onBuy }: { d: DealRow; kind: 'deal' | 'near' | 'sell'; onBuy: (d: DealRow) => void }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{d.player_name}</span>
          {d.card?.rating && <span className="text-xs text-ink-muted">{d.card.rating}</span>}
          <SignalBadge signal={d.signal} />
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-muted">
          <SourceBadge source={d.data_source} />
          {d.latest_seen_on && <span>via {SEEN_ON_LABEL[d.latest_seen_on]}</span>}
          <span>{d.observed_at ? ago(d.observed_at) : ''}</span>
          {d.trend_24h_pct != null && Math.abs(d.trend_24h_pct) >= 10 && (
            <Badge className={d.trend_24h_pct < 0 ? 'border-loss/40 text-loss' : 'border-warn/40 text-warn'}>{pct(d.trend_24h_pct, 0)} 24h</Badge>
          )}
        </div>
      </div>
      <dl className="grid grid-cols-3 gap-3 text-right text-xs">
        <div><dt className="text-ink-faint">Now</dt><dd className="num text-sm">{coins(d.current_price)}</dd></div>
        {kind === 'near' ? (
          <div><dt className="text-ink-faint">Snipe at ≤</dt><dd className="num text-sm text-gold">{coins(d.suggested_max_buy)}</dd></div>
        ) : (
          <div><dt className="text-ink-faint">Sell at</dt><dd className="num text-sm">{coins(d.expected_sell_price)}</dd></div>
        )}
        <div>
          <dt className="text-ink-faint">{kind === 'sell' ? 'ROI' : 'Profit'}</dt>
          <dd className={cx('num text-sm font-semibold', pnlClass(kind === 'sell' ? d.roi_pct : d.estimated_profit))}>
            {kind === 'sell' ? pct(d.roi_pct) : signedCoins(d.estimated_profit)}
          </dd>
        </div>
      </dl>
      {kind !== 'sell' && (
        <Button size="sm" variant={kind === 'deal' ? 'primary' : 'secondary'} onClick={() => onBuy(d)} aria-label={`Buy ${d.player_name}`}>
          <ShoppingCart className="h-3.5 w-3.5" />
        </Button>
      )}
    </li>
  )
}

/** Re-scans every tracked card on a timer and ranks the best deals after tax. */
export default function DealFinder() {
  const toast = useToast()
  const [pref, setPref] = useState(loadPref)
  const [data, setData] = useState<Deals | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)
  const [nextIn, setNextIn] = useState(pref.every)
  const [buy, setBuy] = useState<BuyTarget | null>(null)
  const seen = useRef<Set<string> | null>(null)

  const scan = useCallback(async () => {
    setBusy(true)
    try {
      const d = await api<Deals>('/scanner/deals')
      const ids = new Set(d.deals.map((x) => x.card?.id ?? x.player_name))
      if (seen.current) {
        const fresh = d.deals.filter((x) => !seen.current!.has(x.card?.id ?? x.player_name))
        if (fresh.length) toast('success', `New deal: ${fresh[0].player_name} for an estimated ${signedCoins(fresh[0].estimated_profit)} after tax.`)
      }
      seen.current = ids
      setData(d)
      setError(null)
    } catch (e) {
      setError(e as ApiError)
    } finally {
      setBusy(false)
      setNextIn(pref.every)
    }
  }, [pref.every, toast])

  useEffect(() => void scan(), [scan])
  useRefreshSignal(scan)
  useEffect(() => {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(pref))
    } catch {
      /* storage unavailable */
    }
  }, [pref])
  useEffect(() => {
    if (!pref.auto) return
    const t = setInterval(() => {
      if (document.hidden) return // don't cycle in a background tab
      setNextIn((n) => {
        if (n <= 1) {
          void scan()
          return pref.every
        }
        return n - 1
      })
    }, 1000)
    return () => clearInterval(t)
  }, [pref.auto, pref.every, scan])

  const onBuy = (d: DealRow) =>
    setBuy({ cardId: d.card?.id, playerName: d.player_name, price: d.signal === 'BUY' ? d.current_price : d.suggested_max_buy, targetSell: d.expected_sell_price, isSimulatedData: d.is_simulated })

  return (
    <Card
      title="Deal Finder"
      subtitle={data ? `${data.platform === 'console' ? 'Console' : 'PC'} market · ${data.scanned} cards scanned ${ago(data.generated_at)}${data.stale_or_missing ? ` · ${data.stale_or_missing} waiting on more or fresher prices (3 in 30 days)` : ''}` : 'Scanning your cards…'}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant={pref.auto ? 'primary' : 'secondary'} onClick={() => setPref((p) => ({ ...p, auto: !p.auto }))} aria-pressed={pref.auto}>
            {pref.auto ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {pref.auto ? `Auto-scan · ${nextIn}s` : 'Auto-scan off'}
          </Button>
          <label className="sr-only" htmlFor="deal-every">Scan every</label>
          <select id="deal-every" className="input w-auto py-1 text-xs" value={pref.every} onChange={(e) => setPref((p) => ({ ...p, every: Number(e.target.value) }))}>
            {INTERVALS.map((i) => <option key={i.s} value={i.s}>every {i.label}</option>)}
          </select>
          <Button size="sm" variant="ghost" onClick={() => void scan()} loading={busy} aria-label="Scan now"><RefreshCw className="h-3.5 w-3.5" /></Button>
        </div>
      }
    >
      <ErrorBox error={error} onRetry={scan} />
      {data && !data.deals.length && !data.near.length && !data.sell.length ? (
        <EmptyState title="No deals right now">
          Deals depend on fresh prices. Import a screenshot or record prices, and the finder re-checks every card on each cycle.
        </EmptyState>
      ) : data && (
        <div className="space-y-4">
          {data.deals.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-profit">Buy now · {data.deals.length}</h3>
              <ul className="divide-y divide-line">{data.deals.map((d) => <DealLine key={d.card?.id ?? d.player_name} d={d} kind="deal" onBuy={onBuy} />)}</ul>
            </section>
          )}
          {data.near.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gold">Snipe targets · within 3% of max buy</h3>
              <ul className="divide-y divide-line">{data.near.map((d) => <DealLine key={d.card?.id ?? d.player_name} d={d} kind="near" onBuy={onBuy} />)}</ul>
            </section>
          )}
          {data.sell.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-info">At target sell</h3>
              <ul className="divide-y divide-line">{data.sell.map((d) => <DealLine key={d.card?.id ?? d.player_name} d={d} kind="sell" onBuy={onBuy} />)}</ul>
            </section>
          )}
        </div>
      )}
      <p className="mt-3 text-[11px] text-ink-faint">Auto-scan pauses while this tab is in the background. Estimates are after tax and never guaranteed.</p>
      <BuyDialog target={buy} onClose={() => setBuy(null)} />
    </Card>
  )
}
