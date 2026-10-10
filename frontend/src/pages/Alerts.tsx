import { useCallback, useState } from 'react'
import { Bell, CheckCheck } from 'lucide-react'
import { api } from '../lib/api'
import { useApi } from '../lib/useApi'
import { ago, dateTime } from '../lib/format'
import type { Alert } from '../lib/types'
import { Badge, Button, Card, EmptyState, ErrorBox, PageHeader, Spinner, useToast, cx } from '../components/ui'
import { announceChange, useRefreshSignal } from '../components/Layout'

const TYPES: Record<string, string> = {
  below_target_buy: 'Below target buy',
  target_sell_reached: 'Target sell',
  profit_threshold: 'Profit threshold',
  holding_limit: 'Holding limit',
  stale_data: 'Stale data',
  exposure_limit: 'Exposure',
}

export default function Alerts() {
  const toast = useToast()
  const [type, setType] = useState('')
  const [unread, setUnread] = useState(false)
  const { data, error, loading, reload } = useApi<{ items: Alert[]; unread: number }>(`/alerts?${unread ? 'unread=true&' : ''}${type ? `type=${type}` : ''}`)
  useRefreshSignal(useCallback(() => void reload(), [reload]))

  async function markAll() {
    await api('/alerts/read-all', { method: 'POST' })
    toast('success', 'All alerts marked as read.')
    announceChange()
  }
  async function markOne(a: Alert) {
    await api(`/alerts/${a.id}/read`, { method: 'POST' })
    announceChange()
  }

  return (
    <>
      <PageHeader title="Alerts" subtitle="In-app notifications and their history. Enable or disable each type in Settings."
        actions={<Button onClick={markAll} disabled={!data?.unread}><CheckCheck className="h-4 w-4" /> Mark all read</Button>} />
      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <select className="input w-auto py-1.5" value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter by type">
            <option value="">All types</option>
            {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm text-ink-muted"><input type="checkbox" checked={unread} onChange={(e) => setUnread(e.target.checked)} className="accent-[#2bd576]" /> Unread only</label>
          <span className="ml-auto text-xs text-ink-muted">{data?.unread ?? 0} unread</span>
        </div>
        <ErrorBox error={error} onRetry={reload} />
        {loading && !data ? <Spinner /> : !data?.items.length ? <EmptyState icon={<Bell className="h-8 w-8" />} title="No alerts">Alerts appear when watchlist prices cross your targets, data goes stale or limits are approached.</EmptyState> : (
          <ul className="space-y-2">
            {data.items.map((a) => (
              <li key={a.id} className={cx('flex flex-wrap items-start justify-between gap-2 rounded-lg border-l-2 bg-panel-2 px-3 py-2.5', { success: 'border-profit', info: 'border-info', warning: 'border-warn', danger: 'border-loss' }[a.severity], a.read && 'opacity-60')}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{a.title}</p>
                    <Badge className="border-line-strong text-ink-muted">{TYPES[a.type] ?? a.type}</Badge>
                    {!a.read && <Badge className="border-info/40 text-info">New</Badge>}
                  </div>
                  <p className="mt-0.5 text-sm text-ink-muted">{a.message}</p>
                  <p className="mt-1 text-[11px] text-ink-faint" title={dateTime(a.created_at)}>{ago(a.created_at)}</p>
                </div>
                {!a.read && <Button size="sm" variant="ghost" onClick={() => markOne(a)}>Mark read</Button>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}
