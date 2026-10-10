import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { LayoutGrid, Pencil, PlusCircle, Search } from 'lucide-react'
import { useApi } from '../lib/useApi'
import { ago, coins } from '../lib/format'
import type { CardInfo, MarketCard, Signal, WatchItem } from '../lib/types'
import { Badge, Button, EmptyState, ErrorBox, PageHeader, SignalBadge, SourceBadge, Spinner, cx } from '../components/ui'
import { CardEditDialog, QuickPriceDialog, SEEN_ON_LABEL, SiteLinks } from '../components/CardTools'
import { useRefreshSignal } from '../components/Layout'

type Sort = 'name' | 'rating' | 'price'
const SIGNAL_FILTERS: (Signal | 'ALL' | 'UNWATCHED')[] = ['ALL', 'BUY', 'SELL', 'HOLD', 'WATCH', 'RISK', 'UNWATCHED']

function CardTile({ card, watch, onEdit, onPrice }: { card: MarketCard; watch?: WatchItem; onEdit: () => void; onPrice: () => void }) {
  const s = card.stats
  return (
    <article className="card group flex flex-col overflow-hidden transition-colors hover:border-line-strong">
      <div className="relative flex items-center gap-3 bg-gradient-to-br from-gold/25 via-gold-dim/10 to-transparent p-3">
        <div className="relative flex h-24 w-[72px] shrink-0 flex-col items-center justify-center overflow-hidden rounded-lg border border-gold/50 bg-gradient-to-b from-[#3a2f12] to-[#141008] shadow-[0_6px_20px_-8px_rgba(245,196,81,0.5)]">
          {card.image_url ? (
            <img src={card.image_url} alt={`${card.player_name} card`} loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <>
              <span className="num text-2xl font-bold text-gold">{card.rating ?? '–'}</span>
              <span className="text-[10px] font-semibold tracking-wider text-gold/80">{card.position ?? ''}</span>
            </>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-ink" title={card.player_name}>{card.player_name}</h3>
          <p className="truncate text-xs text-ink-muted">{[card.rating, card.position, card.version].filter(Boolean).join(' · ') || 'Card'}</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {watch ? <SignalBadge signal={watch.signal} /> : <Badge className="border-line text-ink-faint">Not watched</Badge>}
            {card.is_demo && <Badge className="border-gold/40 text-gold">DEMO</Badge>}
          </div>
        </div>
        <button onClick={onEdit} className="absolute right-2 top-2 rounded-md p-1.5 text-ink-faint hover:bg-panel-3 hover:text-ink" aria-label={`Edit ${card.player_name} links and image`}>
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </div>
      <dl className="grid grid-cols-3 gap-2 border-y border-line px-3 py-2.5 text-center">
        <div><dt className="text-[10px] uppercase tracking-wide text-ink-faint">Latest</dt><dd className="num text-sm font-semibold">{coins(s.latest_price)}</dd></div>
        <div><dt className="text-[10px] uppercase tracking-wide text-ink-faint">30d low</dt><dd className="num text-sm">{coins(s.historical_low)}</dd></div>
        <div><dt className="text-[10px] uppercase tracking-wide text-ink-faint">30d high</dt><dd className="num text-sm">{coins(s.historical_high)}</dd></div>
      </dl>
      <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2.5 text-[11px] text-ink-muted">
        <SourceBadge source={s.latest_source} />
        {s.latest_seen_on && <span>via {SEEN_ON_LABEL[s.latest_seen_on]}</span>}
        <span className={cx('ml-auto', s.is_stale && s.latest_at && 'text-warn')}>{s.latest_at ? ago(s.latest_at) : 'no price yet'}</span>
      </div>
      {watch && (
        <p className="px-3 pt-1.5 text-[11px] text-ink-muted">
          Target <span className="num text-ink">{coins(watch.target_buy)}</span> → <span className="num text-ink">{coins(watch.target_sell)}</span>
        </p>
      )}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 p-3">
        <SiteLinks card={card} />
        <div className="flex gap-1">
          <Button size="sm" onClick={onPrice}>Record price</Button>
          {watch && <Link to={`/watchlist/${watch.id}`}><Button size="sm" variant="ghost">Details</Button></Link>}
        </div>
      </div>
    </article>
  )
}

export default function Gallery() {
  const cards = useApi<MarketCard[]>('/market/cards')
  const watch = useApi<WatchItem[]>('/watchlist')
  const reload = useCallback(() => { void cards.reload(); void watch.reload() }, [cards.reload, watch.reload])
  useRefreshSignal(reload)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<(typeof SIGNAL_FILTERS)[number]>('ALL')
  const [sort, setSort] = useState<Sort>('rating')
  const [editing, setEditing] = useState<CardInfo | null>(null)
  const [pricing, setPricing] = useState<CardInfo | null>(null)

  const byCard = useMemo(() => new Map((watch.data ?? []).map((w) => [w.card.id, w])), [watch.data])
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (cards.data ?? [])
      .filter((c) => !needle || c.player_name.toLowerCase().includes(needle) || (c.version ?? '').toLowerCase().includes(needle))
      .filter((c) => {
        const w = byCard.get(c.id)
        if (filter === 'ALL') return true
        if (filter === 'UNWATCHED') return !w
        return w?.signal === filter
      })
      .sort((a, b) =>
        sort === 'name' ? a.player_name.localeCompare(b.player_name)
          : sort === 'rating' ? (b.rating ?? 0) - (a.rating ?? 0) || a.player_name.localeCompare(b.player_name)
          : (b.stats.latest_price ?? 0) - (a.stats.latest_price ?? 0),
      )
  }, [cards.data, byCard, q, filter, sort])

  const loading = (cards.loading && !cards.data) || (watch.loading && !watch.data)
  return (
    <>
      <PageHeader
        title="Card Gallery"
        subtitle="Every card you track, with its latest price and signal. Save each player's FUTBIN and FUT.GG pages to jump straight to them, then record the prices you see."
        actions={<Link to="/watchlist"><Button variant="primary"><PlusCircle className="h-4 w-4" /> Add a player</Button></Link>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <span className="sr-only">Search cards</span>
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-ink-faint" aria-hidden />
          <input className="input pl-8" placeholder="Search cards…" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <div role="tablist" aria-label="Filter by signal" className="flex flex-wrap gap-1 rounded-lg border border-line bg-panel-2 p-1">
          {SIGNAL_FILTERS.map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}
              className={cx('rounded-md px-2 py-1 text-xs', filter === f ? 'bg-panel-3 text-ink' : 'text-ink-muted hover:text-ink')}>
              {f === 'UNWATCHED' ? 'Not watched' : f === 'ALL' ? 'All' : f}
            </button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-2 text-xs text-ink-muted">
          Sort
          <select className="input w-auto py-1.5" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="rating">Rating</option><option value="price">Latest price</option><option value="name">Name</option>
          </select>
        </label>
      </div>
      <ErrorBox error={cards.error ?? watch.error} onRetry={reload} />
      {loading ? <Spinner /> : !cards.data?.length ? (
        <EmptyState icon={<LayoutGrid className="h-8 w-8" />} title="No cards yet" action={<Link to="/watchlist"><Button variant="primary">Add a player</Button></Link>}>
          Cards appear here when you add a player to your watchlist, record a price or import a CSV.
        </EmptyState>
      ) : !visible.length ? (
        <EmptyState title="No matching cards" />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {visible.map((c) => (
            <CardTile key={c.id} card={c} watch={byCard.get(c.id)} onEdit={() => setEditing(c)} onPrice={() => setPricing(c)} />
          ))}
        </div>
      )}
      <CardEditDialog card={editing} onClose={() => setEditing(null)} />
      <QuickPriceDialog card={pricing} onClose={() => setPricing(null)} />
    </>
  )
}
