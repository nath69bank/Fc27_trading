import { useCallback, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Link2, Pencil, ShoppingCart, Trash2, Zap } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { useApi } from '../lib/useApi'
import { coins, dateTime, parseCoins, pct, pnlClass, signedCoins } from '../lib/format'
import type { Opportunity, SeenOn, WatchDetail } from '../lib/types'
import { CardEditDialog, SEEN_ON_LABEL, SeenOnSelect, SiteLinks } from '../components/CardTools'
import { Button, Card, CoinInput, ConfirmDialog, ErrorBox, Field, Metric, Notice, PageHeader, SourceBadge, Spinner, useToast } from '../components/ui'
import { PriceHistoryChart } from '../components/charts'
import OpportunityCard from '../components/OpportunityCard'
import { BuyDialog, type BuyTarget } from '../components/TradeDialogs'
import { announceChange, useRefreshSignal } from '../components/Layout'
import { WatchlistForm } from './Watchlist'

export default function PlayerDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { data, error, loading, reload } = useApi<WatchDetail>(`/watchlist/${id}`)
  useRefreshSignal(useCallback(() => void reload(), [reload]))
  const [price, setPrice] = useState('')
  const [seenOn, setSeenOn] = useState<SeenOn>('ingame')
  const [editLinks, setEditLinks] = useState(false)
  const [priceBusy, setPriceBusy] = useState(false)
  const [priceError, setPriceError] = useState<ApiError | null>(null)
  const [edit, setEdit] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [buy, setBuy] = useState<BuyTarget | null>(null)
  const [evaluated, setEvaluated] = useState<Opportunity | null>(null)

  if (loading && !data) return <Spinner />
  if (error || !data) return <ErrorBox error={error ?? { message: 'Not found' }} onRetry={reload} />
  const opp = evaluated ?? data.opportunity

  async function addPrice(e: React.FormEvent) {
    e.preventDefault()
    const p = parseCoins(price)
    if (!p) return
    setPriceBusy(true)
    setPriceError(null)
    try {
      await api('/market/prices', { method: 'POST', json: { card_id: data!.card.id, price: p, seen_on: seenOn } })
      setPrice('')
      setEvaluated(null)
      toast('success', `Manual price ${coins(p)} recorded (seen on ${SEEN_ON_LABEL[seenOn]}).`)
      announceChange()
    } catch (err) {
      setPriceError(err as ApiError)
    } finally {
      setPriceBusy(false)
    }
  }

  async function evaluate() {
    try {
      setEvaluated(await api<Opportunity>(`/watchlist/${data!.id}/evaluate`, { method: 'POST' }))
      toast('info', 'Evaluation recorded in the signal log.')
      announceChange()
    } catch (err) {
      toast('error', (err as Error).message)
    }
  }

  async function remove() {
    await api(`/watchlist/${data!.id}`, { method: 'DELETE' })
    toast('success', 'Removed from watchlist.')
    announceChange()
    navigate('/watchlist')
  }

  return (
    <>
      <Link to="/watchlist" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="h-4 w-4" /> Watchlist</Link>
      <PageHeader
        title={data.card.player_name}
        subtitle={[data.card.rating, data.card.position, data.card.version].filter(Boolean).join(' · ') || undefined}
        actions={
          <>
            <Button onClick={evaluate}><Zap className="h-4 w-4" /> Evaluate now</Button>
            <Button variant="primary" onClick={() => setBuy({ cardId: data.card.id, playerName: data.card.player_name, price: data.latest_price, targetSell: data.target_sell, isSimulatedData: data.price_stats.is_simulated })}><ShoppingCart className="h-4 w-4" /> Buy</Button>
            <Button variant="ghost" onClick={() => setEdit(true)} aria-label="Edit"><Pencil className="h-4 w-4" /></Button>
            <Button variant="ghost" onClick={() => setConfirmDelete(true)} aria-label="Remove"><Trash2 className="h-4 w-4" /></Button>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SiteLinks card={data.card} size="md" />
        <Button size="sm" variant="ghost" onClick={() => setEditLinks(true)}><Link2 className="h-3.5 w-3.5" /> {data.card.futbin_url || data.card.futgg_url ? 'Edit links' : 'Save FUTBIN / FUT.GG pages'}</Button>
      </div>
      {data.is_demo && <div className="mb-4"><Notice tone="demo">Demo record — this is not a real FC 27 card, and its prices are sample data.</Notice></div>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Latest price" value={coins(data.latest_price)} sub={<span className="inline-flex items-center gap-1"><SourceBadge source={data.latest_source} /> {dateTime(data.last_price_update)}</span>} />
        <Metric label="Target buy / sell" value={<span className="text-lg">{coins(data.target_buy)} / {coins(data.target_sell)}</span>} sub={`Net at target sell: ${coins(data.net_at_target_sell)}`} tone="gold" />
        <Metric label="Planned profit" value={signedCoins(data.estimated_profit)} sub={`${pct(data.estimated_roi_pct)} ROI after tax`} tone={data.estimated_profit >= 0 ? 'profit' : 'loss'} />
        <Metric label="30-day low / high" value={<span className="text-lg">{coins(data.historical_low)} / {coins(data.historical_high)}</span>} sub={`${data.price_stats.points} observations`} />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-4">
          <Card title="Price history" subtitle="Dashed lines: your target buy (green) and target sell (gold)">
            <PriceHistoryChart points={data.price_history} targetBuy={data.target_buy} targetSell={data.target_sell} />
          </Card>
          <Card title="Observations">
            <form onSubmit={addPrice} className="mb-3 flex flex-wrap items-end gap-2">
              <div className="w-40"><Field label="Add manual price">{(fid) => <CoinInput id={fid} value={price} onChange={setPrice} placeholder="e.g. 25,200" />}</Field></div>
              <div className="w-40"><Field label="Seen on">{(fid) => <SeenOnSelect id={fid} value={seenOn} onChange={setSeenOn} />}</Field></div>
              <Button type="submit" variant="primary" loading={priceBusy} disabled={!parseCoins(price)}>Record price</Button>
            </form>
            <ErrorBox error={priceError} />
            <div className="-mx-4 max-h-80 overflow-auto">
              <table className="w-full">
                <thead className="sticky top-0 bg-panel"><tr className="border-b border-line"><th className="th">Observed</th><th className="th text-right">Price</th><th className="th">Source</th><th className="th">Platform</th></tr></thead>
                <tbody>
                  {[...data.price_history].reverse().map((p) => (
                    <tr key={p.id} className="border-b border-line/60"><td className="td text-ink-muted">{dateTime(p.observed_at)}</td><td className="td num text-right">{coins(p.price)}</td><td className="td"><SourceBadge source={p.source} />{p.seen_on && <span className="ml-1.5 text-[11px] text-ink-muted">via {SEEN_ON_LABEL[p.seen_on]}</span>}</td><td className="td text-xs text-ink-muted">{p.platform}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
        <div className="space-y-4">
          <OpportunityCard opp={opp} onBuy={(o) => setBuy({ cardId: data.card.id, playerName: o.player_name, price: o.current_price, targetSell: o.expected_sell_price, isSimulatedData: o.is_simulated })} />
          {data.profit_at_current_price != null && (
            <Card title="At the latest price">
              <p className="text-sm text-ink-muted">Buying at <span className="num text-ink">{coins(data.latest_price)}</span> and selling at your target nets an estimated{' '}
                <span className={`num font-semibold ${pnlClass(data.profit_at_current_price)}`}>{signedCoins(data.profit_at_current_price)}</span> after tax.</p>
            </Card>
          )}
          {data.notes && <Card title="Notes"><p className="whitespace-pre-wrap text-sm text-ink-muted">{data.notes}</p></Card>}
        </div>
      </div>
      <CardEditDialog card={editLinks ? data.card : null} onClose={() => setEditLinks(false)} onSaved={reload} />
      <WatchlistForm open={edit} item={data} onClose={() => setEdit(false)} onSaved={reload} />
      <ConfirmDialog open={confirmDelete} danger title="Remove from watchlist?" confirmLabel="Remove" onClose={() => setConfirmDelete(false)} onConfirm={remove}
        message="Price history and transfers for this card are kept." />
      <BuyDialog target={buy} onClose={() => setBuy(null)} />
    </>
  )
}
