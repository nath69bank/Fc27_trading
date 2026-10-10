import { Check, Minus, ShoppingCart, X } from 'lucide-react'
import { coins, pct, pnlClass, signedCoins } from '../lib/format'
import type { Opportunity } from '../lib/types'
import { Button, PlayerChip, SignalBadge, SourceBadge, cx } from './ui'

function Row({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className={cx('num text-sm', className)}>{value}</dd>
    </div>
  )
}

function Check_({ ok, label }: { ok: boolean | null | undefined; label: string }) {
  const Icon = ok == null ? Minus : ok ? Check : X
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px]', ok == null ? 'border-line text-ink-faint' : ok ? 'border-profit/30 text-profit' : 'border-loss/30 text-loss')}>
      <Icon className="h-3 w-3" aria-hidden />
      {label}
      <span className="sr-only">{ok == null ? 'not evaluated' : ok ? 'passed' : 'failed'}</span>
    </span>
  )
}

export default function OpportunityCard({ opp, onBuy }: { opp: Opportunity; onBuy?: (o: Opportunity) => void }) {
  const glow = opp.signal === 'BUY' ? 'border-profit/40 shadow-[0_0_0_1px_rgba(43,213,118,0.15),0_8px_30px_-12px_rgba(43,213,118,0.35)]' : opp.signal === 'RISK' ? 'border-loss/30' : ''
  return (
    <article className={cx('card flex flex-col p-4', glow)}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <PlayerChip name={opp.player_name} version={opp.card?.version} rating={opp.card?.rating} position={opp.card?.position} image={opp.card?.image_url} />
        <SignalBadge signal={opp.signal} large />
      </div>
      <p className="mb-3 text-sm text-ink">{opp.explanation}</p>
      <dl className="grid grid-cols-1 gap-x-6 border-y border-line py-2 sm:grid-cols-2">
        <Row label="Current buy price" value={coins(opp.current_price)} className="font-semibold" />
        <Row label="Historical low / high" value={`${coins(opp.historical_low)} / ${coins(opp.historical_high)}`} />
        <Row label="Suggested max buy" value={coins(opp.suggested_max_buy)} className="text-gold" />
        <Row label="Expected sell price" value={coins(opp.expected_sell_price)} />
        <Row label="Expected net proceeds" value={coins(opp.expected_net_proceeds)} />
        <Row label="Est. profit after tax" value={signedCoins(opp.estimated_profit)} className={cx('font-semibold', pnlClass(opp.estimated_profit))} />
        <Row label="Estimated ROI" value={pct(opp.roi_pct)} className={pnlClass(opp.roi_pct)} />
        <Row label="Data freshness" value={opp.data_age_hours == null ? '—' : `${opp.data_age_hours < 1 ? '<1' : opp.data_age_hours.toFixed(1)}h old${opp.is_stale ? ' · stale' : ''}`} className={opp.is_stale ? 'text-warn' : ''} />
      </dl>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Check_ ok={opp.checks.entry} label="Entry" />
        <Check_ ok={opp.checks.profit} label="Profit" />
        <Check_ ok={opp.checks.roi} label="ROI" />
        <Check_ ok={opp.checks.fresh} label="Fresh" />
        <span className="ml-auto"><SourceBadge source={opp.data_source} /></span>
      </div>
      {opp.reasons.length > 0 && (
        <details className="mt-3 text-xs text-ink-muted">
          <summary className="cursor-pointer select-none text-ink-muted hover:text-ink">Signal reasoning</summary>
          <ul className="mt-2 list-disc space-y-1 pl-4">{opp.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        </details>
      )}
      <p className="mt-3 text-[11px] leading-snug text-ink-faint">{opp.disclaimer}</p>
      {onBuy && opp.current_price && (opp.signal === 'BUY' || opp.signal === 'HOLD' || opp.signal === 'RISK') && (
        <Button className="mt-3" variant={opp.signal === 'BUY' ? 'primary' : 'secondary'} onClick={() => onBuy(opp)}>
          <ShoppingCart className="h-4 w-4" aria-hidden />
          {opp.signal === 'BUY' ? 'Simulate / record purchase' : 'Buy anyway'}
        </Button>
      )}
    </article>
  )
}
