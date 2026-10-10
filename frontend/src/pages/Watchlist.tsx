import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Pencil, Plus, Search, Star, Trash2, Zap } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { useApi } from '../lib/useApi'
import { ago, coins, parseCoins, pct, pnlClass, signedCoins } from '../lib/format'
import type { Opportunity, WatchItem } from '../lib/types'
import {
  Badge, Button, Card, CoinInput, ConfirmDialog, EmptyState, ErrorBox, Field, Modal, PageHeader, PlayerChip, SignalBadge, SortHeader, SourceBadge, Spinner, useToast, cx,
} from '../components/ui'
import { announceChange, useRefreshSignal } from '../components/Layout'
import OpportunityCard from '../components/OpportunityCard'
import { BuyDialog, type BuyTarget } from '../components/TradeDialogs'

type SortKey = 'name' | 'price' | 'roi' | 'profit' | 'added'

const ALERT_LABEL: Record<WatchItem['alert_status'], { text: string; cls: string }> = {
  below_target_buy: { text: 'At/below buy', cls: 'border-profit/40 text-profit' },
  at_target_sell: { text: 'At sell target', cls: 'border-gold/40 text-gold' },
  stale: { text: 'Stale data', cls: 'border-warn/40 text-warn' },
  no_data: { text: 'No price', cls: 'border-line-strong text-ink-faint' },
  none: { text: 'In range', cls: 'border-line text-ink-muted' },
}

export function WatchlistForm({ item, open, onClose, onSaved }: { item?: WatchItem | null; open: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const editing = Boolean(item)
  const [f, setF] = useState({ name: '', version: '', rating: '', position: '', image: '', buy: '', sell: '', current: '', notes: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  useEffect(() => {
    if (!open) return
    setError(null)
    setF(item
      ? { name: item.card.player_name, version: item.card.version ?? '', rating: String(item.card.rating ?? ''), position: item.card.position ?? '', image: item.card.image_url ?? '', buy: String(item.target_buy), sell: String(item.target_sell), current: '', notes: item.notes }
      : { name: '', version: '', rating: '', position: '', image: '', buy: '', sell: '', current: '', notes: '' })
  }, [open, item])
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }))
  const buy = parseCoins(f.buy), sell = parseCoins(f.sell)
  const clientError = buy && sell && sell <= buy ? 'Target sell must be higher than target buy.' : null

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (clientError) return
    setBusy(true)
    setError(null)
    try {
      if (editing && item) {
        await api(`/watchlist/${item.id}`, { method: 'PATCH', json: { target_buy: buy, target_sell: sell, notes: f.notes, image_url: f.image, position: f.position } })
        toast('success', 'Watchlist entry updated.')
      } else {
        await api('/watchlist', {
          method: 'POST',
          json: {
            player_name: f.name, version: f.version || null, rating: f.rating ? parseInt(f.rating, 10) : null, position: f.position || null,
            image_url: f.image || null, target_buy: buy, target_sell: sell, current_price: parseCoins(f.current) ?? undefined, notes: f.notes,
          },
        })
        toast('success', `${f.name} added to your watchlist.`)
      }
      announceChange()
      onSaved()
      onClose()
    } catch (err) {
      setError(err as ApiError)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? `Edit ${item?.card.player_name}` : 'Add player to watchlist'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="wl-form" loading={busy}>{editing ? 'Save changes' : 'Add to watchlist'}</Button></>}>
      <form id="wl-form" onSubmit={save} className="space-y-3">
        <ErrorBox error={error} />
        {!editing && <Field label="Player name">{(id) => <input id={id} className="input" value={f.name} onChange={(e) => set('name')(e.target.value)} required maxLength={120} autoFocus />}</Field>}
        <div className="grid grid-cols-3 gap-2">
          {!editing && <Field label="Card version">{(id) => <input id={id} className="input" value={f.version} onChange={(e) => set('version')(e.target.value)} placeholder="Gold Rare" />}</Field>}
          {!editing && <Field label="Rating">{(id) => <input id={id} className="input num" type="number" min={1} max={99} value={f.rating} onChange={(e) => set('rating')(e.target.value)} />}</Field>}
          <Field label="Position">{(id) => <input id={id} className="input" value={f.position} onChange={(e) => set('position')(e.target.value.toUpperCase())} maxLength={8} placeholder="ST" />}</Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Target buy">{(id) => <CoinInput id={id} value={f.buy} onChange={set('buy')} required />}</Field>
          <Field label="Target sell" error={clientError}>{(id) => <CoinInput id={id} value={f.sell} onChange={set('sell')} required />}</Field>
        </div>
        {!editing && <Field label="Current market price (optional)" hint="Saved as a Manual price observation">{(id) => <CoinInput id={id} value={f.current} onChange={set('current')} />}</Field>}
        <Field label="Image URL (optional)">{(id) => <input id={id} className="input" type="url" value={f.image} onChange={(e) => set('image')(e.target.value)} placeholder="https://…" />}</Field>
        <Field label="Notes">{(id) => <textarea id={id} className="input h-16" value={f.notes} onChange={(e) => set('notes')(e.target.value)} maxLength={1000} />}</Field>
      </form>
    </Modal>
  )
}

export default function Watchlist() {
  const toast = useToast()
  const [q, setQ] = useState('')
  const [fav, setFav] = useState(false)
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'added', desc: true })
  const path = `/watchlist?sort=${sort.key}&order=${sort.desc ? 'desc' : 'asc'}${fav ? '&favourites=true' : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`
  const { data, error, loading, reload } = useApi<WatchItem[]>(path)
  useRefreshSignal(useCallback(() => void reload(), [reload]))
  const [form, setForm] = useState<{ open: boolean; item: WatchItem | null }>({ open: false, item: null })
  const [removing, setRemoving] = useState<WatchItem | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)
  const [evaluation, setEvaluation] = useState<Opportunity | null>(null)
  const [evalBusy, setEvalBusy] = useState<string | null>(null)
  const [buy, setBuy] = useState<BuyTarget | null>(null)

  async function toggleFav(w: WatchItem) {
    try {
      await api(`/watchlist/${w.id}`, { method: 'PATCH', json: { favourite: !w.favourite } })
      void reload()
    } catch (e) {
      toast('error', (e as Error).message)
    }
  }
  async function evaluate(w: WatchItem) {
    setEvalBusy(w.id)
    try {
      setEvaluation(await api<Opportunity>(`/watchlist/${w.id}/evaluate`, { method: 'POST' }))
      announceChange()
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      setEvalBusy(null)
    }
  }
  async function remove() {
    if (!removing) return
    setRemoveBusy(true)
    try {
      await api(`/watchlist/${removing.id}`, { method: 'DELETE' })
      toast('success', `${removing.card.player_name} removed from your watchlist.`)
      setRemoving(null)
      announceChange()
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      setRemoveBusy(false)
    }
  }

  return (
    <>
      <PageHeader title="Player Watchlist" subtitle="add_to_watchlist(): track target buy and sell prices. Planned profit assumes buying at target buy and selling at target sell, after 5% tax."
        actions={<Button variant="primary" onClick={() => setForm({ open: true, item: null })}><Plus className="h-4 w-4" /> Add player</Button>} />
      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <span className="sr-only">Search watchlist</span>
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-ink-faint" aria-hidden />
            <input className="input pl-8" placeholder="Search players…" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <Button variant={fav ? 'gold' : 'secondary'} size="sm" onClick={() => setFav(!fav)} aria-pressed={fav}><Star className="h-3.5 w-3.5" /> Favourites</Button>
          <label className="flex items-center gap-2 text-xs text-ink-muted sm:hidden">
            Sort
            <select className="input py-1" value={sort.key} onChange={(e) => setSort({ key: e.target.value as SortKey, desc: true })}>
              <option value="added">Date added</option><option value="name">Name</option><option value="price">Price</option><option value="roi">ROI</option><option value="profit">Profit</option>
            </select>
          </label>
        </div>
        <ErrorBox error={error} onRetry={reload} />
        {loading && !data ? <Spinner /> : !data?.length ? (
          <EmptyState icon={<Star className="h-8 w-8" />} title={q || fav ? 'No matching players' : 'Your watchlist is empty'}
            action={!q && !fav && <Button variant="primary" onClick={() => setForm({ open: true, item: null })}>Add your first player</Button>}>
            {!q && !fav && 'Add a player with target buy and sell prices to start generating signals.'}
          </EmptyState>
        ) : (
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line">
                  <th className="th w-8"><span className="sr-only">Favourite</span></th>
                  <SortHeader label="Player" k="name" sort={sort} setSort={setSort} />
                  <th className="th text-right">Target buy</th>
                  <th className="th text-right">Target sell</th>
                  <SortHeader label="Latest price" k="price" sort={sort} setSort={setSort} align="right" />
                  <SortHeader label="Planned profit" k="profit" sort={sort} setSort={setSort} align="right" />
                  <SortHeader label="Est. ROI" k="roi" sort={sort} setSort={setSort} align="right" />
                  <th className="th">Signal</th>
                  <th className="th">Alert</th>
                  <SortHeader label="Added" k="added" sort={sort} setSort={setSort} />
                  <th className="th text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.map((w) => (
                  <tr key={w.id} className="border-b border-line/60 transition-colors last:border-0 hover:bg-panel-2/60">
                    <td className="td">
                      <button onClick={() => toggleFav(w)} aria-label={w.favourite ? 'Remove favourite' : 'Mark favourite'} aria-pressed={w.favourite} className="rounded p-1 hover:bg-panel-3">
                        <Star className={cx('h-4 w-4', w.favourite ? 'fill-gold text-gold' : 'text-ink-faint')} />
                      </button>
                    </td>
                    <td className="td">
                      <Link to={`/watchlist/${w.id}`} className="flex items-center gap-2 hover:underline">
                        <PlayerChip name={w.card.player_name} version={w.card.version} rating={w.card.rating} position={w.card.position} image={w.card.image_url} />
                        {w.is_demo && <Badge className="border-gold/40 text-gold">DEMO</Badge>}
                      </Link>
                    </td>
                    <td className="td num text-right">{coins(w.target_buy)}</td>
                    <td className="td num text-right">{coins(w.target_sell)}</td>
                    <td className="td text-right">
                      <div className="num font-medium">{coins(w.latest_price)}</div>
                      <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-ink-faint">{w.latest_source && <SourceBadge source={w.latest_source} />}{w.last_price_update && ago(w.last_price_update)}</div>
                    </td>
                    <td className={cx('td num text-right font-medium', pnlClass(w.estimated_profit))}>{signedCoins(w.estimated_profit)}</td>
                    <td className={cx('td num text-right', pnlClass(w.estimated_roi_pct))}>{pct(w.estimated_roi_pct)}</td>
                    <td className="td" title={w.signal_explanation}><SignalBadge signal={w.signal} /></td>
                    <td className="td"><Badge className={ALERT_LABEL[w.alert_status].cls}>{ALERT_LABEL[w.alert_status].text}</Badge></td>
                    <td className="td text-xs text-ink-muted">{ago(w.created_at)}</td>
                    <td className="td">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="secondary" onClick={() => evaluate(w)} loading={evalBusy === w.id} title="Evaluate opportunity now"><Zap className="h-3.5 w-3.5" /> Evaluate</Button>
                        <Button size="sm" variant="ghost" onClick={() => setForm({ open: true, item: w })} aria-label={`Edit ${w.card.player_name}`}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => setRemoving(w)} aria-label={`Remove ${w.card.player_name}`}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <WatchlistForm open={form.open} item={form.item} onClose={() => setForm({ open: false, item: null })} onSaved={reload} />
      <ConfirmDialog open={Boolean(removing)} title="Remove from watchlist?" danger confirmLabel="Remove" busy={removeBusy} onClose={() => setRemoving(null)} onConfirm={remove}
        message={<>Remove <strong className="text-ink">{removing?.card.player_name}</strong> from your watchlist? Its price history and any transfers are kept.</>} />
      <Modal open={Boolean(evaluation)} onClose={() => setEvaluation(null)} title="Opportunity evaluation" wide>
        {evaluation && <OpportunityCard opp={evaluation} onBuy={(o) => { setEvaluation(null); setBuy({ cardId: o.card?.id, playerName: o.player_name, price: o.current_price, targetSell: o.expected_sell_price, isSimulatedData: o.is_simulated }) }} />}
      </Modal>
      <BuyDialog target={buy} onClose={() => setBuy(null)} />
    </>
  )
}
