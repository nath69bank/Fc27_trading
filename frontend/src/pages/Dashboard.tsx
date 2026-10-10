import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Bell, CheckCircle2, Circle, Coins as CoinsIcon, Layers, LineChart, Percent, PiggyBank, Wallet } from 'lucide-react'
import { useApi } from '../lib/useApi'
import type { Dashboard as DashboardData, Opportunity } from '../lib/types'
import { ago, coins, dateTime, pct, pnlClass, signedCoins } from '../lib/format'
import { Button, Card, EmptyState, ErrorBox, Metric, Notice, PageHeader, PlayerChip, SignalBadge, Skeleton, SourceBadge, cx } from '../components/ui'
import { DataModeIndicator, useRefreshSignal } from '../components/Layout'
import { CumulativeProfitChart } from '../components/charts'
import OpportunityCard from '../components/OpportunityCard'
import { BuyDialog, type BuyTarget } from '../components/TradeDialogs'

function Walkthrough({ w }: { w: DashboardData['walkthrough'] }) {
  const steps = [
    { done: w.watchlist, label: 'Add a player to your watchlist', to: '/watchlist' },
    { done: w.evaluated, label: 'Evaluate a price & get a signal', to: '/scanner' },
    { done: w.purchased, label: 'Simulate a purchase', to: '/scanner' },
    { done: w.sold, label: 'Record a sale', to: '/transfers' },
    { done: w.sold, label: 'Check realised profit', to: '/performance' },
  ]
  if (steps.every((s) => s.done)) return null
  return (
    <Card title="Demo workflow" subtitle="The end-to-end loop, using your own records">
      <ol className="grid gap-2 sm:grid-cols-5">
        {steps.map((s, i) => (
          <li key={s.label}>
            <Link to={s.to} className={cx('flex h-full items-start gap-2 rounded-lg border p-2.5 text-xs transition-colors hover:border-line-strong', s.done ? 'border-profit/30 bg-profit/5 text-ink' : 'border-line text-ink-muted')}>
              {s.done ? <CheckCircle2 className="h-4 w-4 shrink-0 text-profit" aria-label="done" /> : <Circle className="h-4 w-4 shrink-0" aria-label="to do" />}
              <span><span className="num text-ink-faint">{i + 1}.</span> {s.label}</span>
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  )
}

export default function Dashboard() {
  const { data, error, loading, reload } = useApi<DashboardData>('/dashboard')
  const [buy, setBuy] = useState<BuyTarget | null>(null)
  useRefreshSignal(useCallback(() => void reload(), [reload]))

  const onBuy = (o: Opportunity) =>
    setBuy({ cardId: o.card?.id, playerName: o.player_name, price: o.current_price, targetSell: o.expected_sell_price, isSimulatedData: o.is_simulated })

  if (error && !data) return <ErrorBox error={error} onRetry={reload} />
  const m = data?.metrics
  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={data ? <>Market data: <span className="text-ink">{data.data_status.mode === 'none' ? 'none yet' : `${data.data_status.last_source} · updated ${ago(data.data_status.last_updated)}`}</span></> : 'Loading your market overview…'}
        actions={<DataModeIndicator status={data?.data_status ?? null} compact />}
      />
      {data?.user.is_demo && (
        <div className="mb-4">
          <Notice tone="demo">
            <strong>Demo account.</strong> Players such as “Meta Gold Winger” are editable demo records and their prices are sample data — not real FC 27 cards or market prices. Coins here are virtual.
          </Notice>
        </div>
      )}
      {data?.data_status.is_stale && data.data_status.mode !== 'none' && (
        <div className="mb-4">
          <Notice tone="warn">Market data is {data.data_status.age_hours?.toFixed(0)}h old (limit {data.data_status.stale_after_hours}h). Signals show WATCH until you add a fresh price on <Link className="underline" to="/prices">Price History</Link>.</Notice>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {m ? (
          <>
            <Metric label="Available coins" value={coins(m.available_coins)} sub="Free for new purchases" icon={<Wallet className="h-4 w-4" />} tone="gold" />
            <Metric label="Invested coins" value={coins(m.invested_coins)} sub="Cost of open transfers" icon={<Layers className="h-4 w-4" />} />
            <Metric label="Portfolio value" value={coins(m.portfolio_value)} sub={<>Unrealised <span className={pnlClass(m.unrealised_profit)}>{signedCoins(m.unrealised_profit)}</span> after tax</>} icon={<PiggyBank className="h-4 w-4" />} />
            <Metric label="Realised profit" value={signedCoins(m.total_realised_profit)} sub={`${m.completed_trades} completed trade${m.completed_trades === 1 ? '' : 's'}`} tone={m.total_realised_profit > 0 ? 'profit' : m.total_realised_profit < 0 ? 'loss' : 'default'} icon={<CoinsIcon className="h-4 w-4" />} />
            <Metric label="Open transfers" value={m.open_transfers} sub="Active investments" icon={<LineChart className="h-4 w-4" />} />
            <Metric label="Trading ROI" value={pct(m.trading_roi_pct)} sub="Realised, on capital used" tone={m.trading_roi_pct > 0 ? 'profit' : m.trading_roi_pct < 0 ? 'loss' : 'default'} icon={<Percent className="h-4 w-4" />} />
          </>
        ) : (
          Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[104px]" />)
        )}
      </div>

      {data && <div className="mt-4"><Walkthrough w={data.walkthrough} /></div>}

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card
            title="Best potential opportunities"
            subtitle="Live evaluation of your watchlist against your settings"
            actions={<Link to="/scanner"><Button size="sm" variant="ghost">Open scanner <ArrowRight className="h-3.5 w-3.5" /></Button></Link>}
          >
            {loading && !data ? <Skeleton className="h-48" /> : data?.opportunities.length ? (
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{data.opportunities.map((o) => <OpportunityCard key={o.watchlist_id ?? o.player_name} opp={o} onBuy={onBuy} />)}</div>
            ) : (
              <EmptyState title="No BUY or SELL signals right now">Signals appear when a watchlisted card meets your entry, profit and ROI rules — or reaches its target sell price.</EmptyState>
            )}
          </Card>

          <Card title="Realised profit & loss" subtitle="Cumulative, from completed trades only">
            <CumulativeProfitChart data={data?.pnl_chart ?? []} />
          </Card>

          <Card title="Recent completed trades" actions={<Link to="/history"><Button size="sm" variant="ghost">Trade history <ArrowRight className="h-3.5 w-3.5" /></Button></Link>}>
            {data?.recent_trades.length ? (
              <div className="-mx-4 overflow-x-auto">
                <table className="w-full">
                  <thead><tr className="border-b border-line"><th className="th">Player</th><th className="th text-right">Qty</th><th className="th text-right">Net proceeds</th><th className="th text-right">Profit</th><th className="th text-right">ROI</th><th className="th">Sold</th></tr></thead>
                  <tbody>
                    {data.recent_trades.map((t) => (
                      <tr key={t.id} className="border-b border-line/60 last:border-0">
                        <td className="td font-medium">{t.player_name}</td>
                        <td className="td num text-right">{t.quantity}</td>
                        <td className="td num text-right">{coins(t.net_proceeds)}</td>
                        <td className={cx('td num text-right font-semibold', pnlClass(t.realised_profit))}>{signedCoins(t.realised_profit)}</td>
                        <td className={cx('td num text-right', pnlClass(t.roi_pct))}>{pct(t.roi_pct)}</td>
                        <td className="td text-ink-muted">{dateTime(t.sold_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <EmptyState title="No completed trades yet">Record a sale on Active Transfers to see it here.</EmptyState>}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Watchlist alerts" actions={<Link to="/alerts"><Button size="sm" variant="ghost"><Bell className="h-3.5 w-3.5" /> All</Button></Link>}>
            {data?.alerts.items.length ? (
              <ul className="space-y-2">
                {data.alerts.items.map((a) => (
                  <li key={a.id} className={cx('rounded-lg border-l-2 bg-panel-2 px-3 py-2', { success: 'border-profit', info: 'border-info', warning: 'border-warn', danger: 'border-loss' }[a.severity])}>
                    <p className="text-sm font-medium">{a.title}</p>
                    <p className="text-xs text-ink-muted">{a.message}</p>
                    <p className="mt-1 text-[10px] text-ink-faint">{ago(a.created_at)}</p>
                  </li>
                ))}
              </ul>
            ) : <EmptyState title="No unread alerts" />}
          </Card>

          <Card title="Approaching target sell" subtitle="Open transfers at 90%+ of target">
            {data?.approaching_target.length ? (
              <ul className="space-y-3">
                {data.approaching_target.map((t) => (
                  <li key={t.id}>
                    <div className="flex items-center justify-between gap-2">
                      <PlayerChip name={t.player_name} rating={t.card.rating} position={t.card.position} version={t.card.version} />
                      <span className="num text-sm">{coins(t.current_price)} / {coins(t.target_sell_price)}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-panel-3" role="progressbar" aria-valuenow={t.progress_to_target_pct ?? 0} aria-valuemin={0} aria-valuemax={100}>
                      <div className="h-full rounded-full bg-gold" style={{ width: `${Math.min(100, t.progress_to_target_pct ?? 0)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : <EmptyState title="Nothing near target yet">{m && m.open_transfers === 0 ? 'You have no open transfers.' : 'Update estimated prices on Active Transfers.'}</EmptyState>}
          </Card>

          <Card title="Recent trading signals" actions={<Link to="/scanner"><Button size="sm" variant="ghost">Scanner</Button></Link>}>
            {data?.recent_signals.length ? (
              <ul className="divide-y divide-line">
                {data.recent_signals.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm">{s.player_name}</p>
                      <p className="text-[11px] text-ink-faint">{ago(s.created_at)} · <span className="num">{coins(s.current_price)}</span></p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5"><SourceBadge source={s.data_source} /><SignalBadge signal={s.signal} /></div>
                  </li>
                ))}
              </ul>
            ) : <EmptyState title="No evaluations recorded">Run a scan or evaluate a watchlist player.</EmptyState>}
          </Card>
        </div>
      </div>
      <BuyDialog target={buy} onClose={() => setBuy(null)} />
    </>
  )
}
