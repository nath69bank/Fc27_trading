import { useCallback, useState } from 'react'
import { useApi } from '../lib/useApi'
import { coins, duration, pct, plainPct, shortDate, signedCoins } from '../lib/format'
import type { Report } from '../lib/types'
import { Card, ErrorBox, Metric, Notice, PageHeader, Skeleton, cx } from '../components/ui'
import { CountBarChart, CumulativeProfitChart, OUTCOME_COLORS, SignedBarChart, ValueLineChart } from '../components/charts'
import { useRefreshSignal } from '../components/Layout'

export default function Performance() {
  const { data: r, error, loading, reload } = useApi<Report>('/reports/performance')
  useRefreshSignal(useCallback(() => void reload(), [reload]))
  const [period, setPeriod] = useState<'daily' | 'weekly'>('daily')

  if (error && !r) return <ErrorBox error={error} onRetry={reload} />
  return (
    <>
      <PageHeader title="Performance Analytics" subtitle="generate_performance_report(): realised results from settled trades only. Unsold cards are shown separately as unrealised and never counted as earnings." />
      {r?.has_simulated_trades && <div className="mb-4"><Notice tone="demo">Includes simulated trades made with virtual coins.</Notice></div>}
      {loading && !r ? <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div> : r && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-5">
            <Metric label="Net realised profit" value={signedCoins(r.net_realised_profit)} tone={r.net_realised_profit > 0 ? 'profit' : r.net_realised_profit < 0 ? 'loss' : 'default'} sub={`ROI ${pct(r.trading_roi_pct)} on ${coins(r.total_cost_basis)} used`} />
            <Metric label="Completed trades" value={r.total_trades} sub={`${r.profitable_trades} won · ${r.losing_trades} lost · ${r.breakeven_trades} flat`} />
            <Metric label="Win rate" value={plainPct(r.win_rate_pct)} />
            <Metric label="Realised gains / losses" value={<span className="text-lg"><span className="text-profit">{signedCoins(r.total_realised_profit)}</span> / <span className="text-loss">{signedCoins(-r.total_realised_losses)}</span></span>} />
            <Metric label="Avg profit per trade" value={signedCoins(r.average_profit_per_trade)} sub={`Avg ROI ${pct(r.average_roi_pct)}`} tone={r.average_profit_per_trade > 0 ? 'profit' : r.average_profit_per_trade < 0 ? 'loss' : 'default'} />
            <Metric label="Best trade" value={r.best_trade ? signedCoins(r.best_trade.realised_profit) : '—'} sub={r.best_trade ? `${r.best_trade.player_name} · ${shortDate(r.best_trade.sold_at)}` : 'No trades yet'} tone={r.best_trade && r.best_trade.realised_profit > 0 ? 'profit' : 'default'} />
            <Metric label="Worst trade" value={r.worst_trade ? signedCoins(r.worst_trade.realised_profit) : '—'} sub={r.worst_trade ? `${r.worst_trade.player_name} · ${shortDate(r.worst_trade.sold_at)}` : 'No trades yet'} tone={r.worst_trade && r.worst_trade.realised_profit < 0 ? 'loss' : 'default'} />
            <Metric label="Avg holding time" value={duration(r.average_holding_hours)} />
            <Metric label="Available / invested" value={<span className="text-lg">{coins(r.available_coins)} / {coins(r.invested_coins)}</span>} tone="gold" />
            <Metric label="Total portfolio value" value={coins(r.total_portfolio_value)} sub={<>Cards {coins(r.active_cards_value)} · unrealised <span className={cx(r.unrealised_profit >= 0 ? 'text-profit' : 'text-loss')}>{signedCoins(r.unrealised_profit)}</span></>} />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card title="Cumulative realised profit"><CumulativeProfitChart data={r.charts.cumulative_profit} /></Card>
            <Card title={`${period === 'daily' ? 'Daily' : 'Weekly'} realised profit`} actions={
              <div role="tablist" className="flex gap-1 text-xs">
                {(['daily', 'weekly'] as const).map((p) => (
                  <button key={p} role="tab" aria-selected={period === p} onClick={() => setPeriod(p)} className={cx('rounded-md px-2 py-1 capitalize', period === p ? 'bg-panel-3 text-ink' : 'text-ink-muted hover:text-ink')}>{p}</button>
                ))}
              </div>
            }>
              <SignedBarChart data={period === 'daily' ? r.charts.daily_profit : r.charts.weekly_profit} xKey="period" xFormat={(v) => (period === 'weekly' ? `w/c ${shortDate(v)}` : shortDate(v))} />
            </Card>
            <Card title="Profit by player"><SignedBarChart data={r.charts.profit_by_player} xKey="player_name" horizontal height={200} /></Card>
            <Card title="ROI distribution" subtitle="Number of trades per ROI band"><CountBarChart data={r.charts.roi_distribution} xKey="bucket" /></Card>
            <Card title="Winning vs losing trades"><CountBarChart data={r.charts.wins_vs_losses} xKey="outcome" colors={OUTCOME_COLORS} /></Card>
            <Card title="Account value over time" subtitle="Available + invested coins at cost, after each balance change"><ValueLineChart data={r.charts.portfolio_value} /></Card>
          </div>
        </>
      )}
    </>
  )
}
