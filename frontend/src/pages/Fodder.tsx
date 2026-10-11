import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Eye, ShoppingCart } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { useApi } from '../lib/useApi'
import { ago, coins, parseCoins, pct, pnlClass, signedCoins } from '../lib/format'
import type { FodderBoard, FodderRow, SeenOn } from '../lib/types'
import { Button, Card, CoinInput, ErrorBox, Field, Notice, PageHeader, SourceBadge, Spinner, useToast, cx } from '../components/ui'
import { SEEN_ON_LABEL, SeenOnSelect } from '../components/CardTools'
import { BuyDialog, type BuyTarget } from '../components/TradeDialogs'
import { announceChange, useRefreshSignal } from '../components/Layout'

function useDebounced<T>(value: T, ms = 400) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

function FloorInput({ row, seenOn, onSaved }: { row: FodderRow; seenOn: SeenOn; onSaved: () => void }) {
  const toast = useToast()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  async function save(e: React.FormEvent) {
    e.preventDefault()
    const price = parseCoins(value)
    if (!price) return
    setBusy(true)
    try {
      await api(`/fodder/${row.rating}/price`, { method: 'POST', json: { price, seen_on: seenOn } })
      toast('success', `${row.rating}-rated floor recorded at ${coins(price)} (${SEEN_ON_LABEL[seenOn]}).`)
      setValue('')
      announceChange()
      onSaved()
    } catch (err) {
      toast('error', (err as ApiError).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={save} className="flex items-center gap-1">
      <label className="sr-only" htmlFor={`floor-${row.rating}`}>New {row.rating}-rated floor</label>
      <input id={`floor-${row.rating}`} className="input num w-24 py-1.5 text-xs" inputMode="numeric" placeholder="New floor" value={value}
        onChange={(e) => setValue(e.target.value.replace(/[^\d,]/g, ''))} />
      <Button size="sm" type="submit" loading={busy} disabled={!parseCoins(value)}>Save</Button>
    </form>
  )
}

export default function Fodder() {
  const toast = useToast()
  const [uplift, setUplift] = useState('15')
  const [budget, setBudget] = useState('50000')
  const [seenOn, setSeenOn] = useState<SeenOn>('futbin')
  const [buy, setBuy] = useState<BuyTarget | null>(null)
  const q = useDebounced(`uplift_pct=${Number(uplift) || 0}${parseCoins(budget) ? `&budget=${parseCoins(budget)}` : ''}`)
  const { data, error, loading, reload } = useApi<FodderBoard>(`/fodder?${q}`)
  useRefreshSignal(useCallback(() => void reload(), [reload]))

  async function watch(row: FodderRow) {
    if (!row.floor || !row.break_even_sell) return
    try {
      await api('/watchlist', {
        method: 'POST',
        json: { player_name: row.name, version: 'Rated fodder', rating: row.rating, target_buy: row.floor, target_sell: row.sell_at_uplift ?? row.break_even_sell + 500,
          notes: 'SBC fodder: buy at the floor before a big SBC, sell into the demand spike.' },
      })
      toast('success', `${row.name} added to your watchlist.`)
      announceChange()
    } catch (err) {
      toast('error', (err as ApiError).message)
    }
  }

  const priced = data?.ratings.filter((r) => r.floor) ?? []
  return (
    <>
      <PageHeader
        title="Fodder Tracker"
        subtitle="Big SBCs eat high-rated cards, so the cheapest gold at each rating (the 'floor') spikes when a demanding SBC or promo lands. Track the floors, then see what a spike would actually pay after tax."
      />
      <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Notice>
          <strong>How traders use it:</strong> buy floors before a catalyst (a big SBC, Icon/Hero swaps, a promo), sell into the demand,
          and get out before the SBC expires. Floors fall when supply floods back (big pack releases, SBC expiry).
          It is speculation: if the SBC is weaker than expected, floors can drop.
        </Notice>
        <div className="card grid grid-cols-3 gap-2 p-3">
          <Field label="If floors rise by %">{(id) => <input id={id} className="input num" inputMode="decimal" value={uplift} onChange={(e) => setUplift(e.target.value.replace(/[^\d.]/g, ''))} />}</Field>
          <Field label="Budget per rating">{(id) => <CoinInput id={id} value={budget} onChange={setBudget} />}</Field>
          <Field label="Prices seen on">{(id) => <SeenOnSelect id={id} value={seenOn} onChange={setSeenOn} />}</Field>
        </div>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      <Card title="Rating floors" subtitle={data ? `Selling into a ${data.uplift_pct}% rise, after ${data.tax_rate_pct}% tax` : undefined}>
        {loading && !data ? <Spinner /> : data && (
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line">
                  <th className="th">Rating</th><th className="th text-right">Floor</th><th className="th">Updated</th><th className="th text-right">24h</th>
                  <th className="th text-right" title="Lowest resale that recovers the floor after tax">Break-even</th>
                  <th className="th text-right">Sell at +{data.uplift_pct}%</th><th className="th text-right">Profit / card</th><th className="th text-right">ROI</th>
                  {data.budget && <th className="th text-right">Budget buys</th>}{data.budget && <th className="th text-right">Profit on budget</th>}
                  <th className="th">Record floor</th><th className="th text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.ratings.map((r) => (
                  <tr key={r.rating} className="border-b border-line/60 last:border-0 hover:bg-panel-2/60">
                    <td className="td"><span className="inline-flex h-8 w-7 items-center justify-center rounded-md border border-gold/50 bg-gradient-to-b from-gold/30 to-gold-dim/10 text-xs font-bold text-gold">{r.rating}</span></td>
                    <td className="td num text-right font-semibold">{coins(r.floor)}</td>
                    <td className="td text-xs text-ink-muted">
                      {r.stats?.latest_at ? (
                        <span className={cx('inline-flex items-center gap-1', r.stats.is_stale && 'text-warn')}>
                          {ago(r.stats.latest_at)}{r.stats.latest_seen_on && ` · ${SEEN_ON_LABEL[r.stats.latest_seen_on]}`}
                          {!r.stats.latest_seen_on && <SourceBadge source={r.stats.latest_source} />}
                        </span>
                      ) : 'no price yet'}
                    </td>
                    <td className={cx('td num text-right', pnlClass(r.stats?.trend_24h_pct))}>{pct(r.stats?.trend_24h_pct, 1)}</td>
                    <td className="td num text-right text-ink-muted">{coins(r.break_even_sell)}</td>
                    <td className="td num text-right">{coins(r.sell_at_uplift)}</td>
                    <td className={cx('td num text-right font-medium', pnlClass(r.profit_per_card))}>{signedCoins(r.profit_per_card)}</td>
                    <td className={cx('td num text-right', pnlClass(r.roi_pct))}>{pct(r.roi_pct)}</td>
                    {data.budget && <td className="td num text-right">{r.budget_qty ?? '—'}</td>}
                    {data.budget && <td className={cx('td num text-right', pnlClass(r.budget_profit))}>{signedCoins(r.budget_profit)}</td>}
                    <td className="td"><FloorInput row={r} seenOn={seenOn} onSaved={reload} /></td>
                    <td className="td">
                      <div className="flex justify-end gap-1">
                        {r.card && r.floor && (
                          <Button size="sm" variant="primary" onClick={() => setBuy({ cardId: r.card!.id, playerName: r.name, price: r.floor, targetSell: r.sell_at_uplift, isSimulatedData: r.stats?.is_simulated })}>
                            <ShoppingCart className="h-3.5 w-3.5" /> Buy
                          </Button>
                        )}
                        {r.floor && <Button size="sm" variant="ghost" onClick={() => watch(r)} title="Watch for alerts and signals"><Eye className="h-3.5 w-3.5" /></Button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && !priced.length && (
          <p className="mt-3 text-sm text-ink-muted">
            Record today's floors (the cheapest gold at each rating on FUTBIN, FUT.GG or the in-game market) to start building history.
            See the <Link to="/playbook" className="text-info underline">Trading Playbook</Link> for how fodder investing works.
          </p>
        )}
      </Card>
      <BuyDialog target={buy} onClose={() => setBuy(null)} />
    </>
  )
}
