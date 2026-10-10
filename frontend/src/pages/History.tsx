import { useCallback, useState } from 'react'
import { BookOpen, Download, Search } from 'lucide-react'
import { getToken } from '../lib/api'
import { useApi } from '../lib/useApi'
import { coins, dateTime, duration, pct, pnlClass, signedCoins } from '../lib/format'
import type { LedgerEntry } from '../lib/types'
import { Button, Card, EmptyState, ErrorBox, ModeBadge, PageHeader, Pagination, SortHeader, Spinner, useToast, cx } from '../components/ui'
import { useRefreshSignal } from '../components/Layout'

type SortKey = 'sold_at' | 'profit' | 'roi' | 'player' | 'net'

export default function History() {
  const toast = useToast()
  const [q, setQ] = useState('')
  const [outcome, setOutcome] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'sold_at', desc: true })
  const [page, setPage] = useState(1)
  const pageSize = 25
  const path = `/ledger?page=${page}&page_size=${pageSize}&sort=${sort.key}&order=${sort.desc ? 'desc' : 'asc'}${outcome ? `&outcome=${outcome}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`
  const { data, error, loading, reload } = useApi<{ items: LedgerEntry[]; total: number }>(path)
  useRefreshSignal(useCallback(() => void reload(), [reload]))

  async function exportCsv() {
    try {
      const res = await fetch('/api/ledger/export.csv', { headers: { Authorization: `Bearer ${getToken()}` } })
      if (!res.ok) throw new Error('Export failed')
      const url = URL.createObjectURL(await res.blob())
      const a = Object.assign(document.createElement('a'), { href: url, download: 'fc27-trade-ledger.csv' })
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      toast('error', (e as Error).message)
    }
  }

  return (
    <>
      <PageHeader title="Trade History" subtitle="The settlement ledger: one immutable row per recorded sale, with tax and realised profit calculated on the server."
        actions={<Button onClick={exportCsv} disabled={!data?.total}><Download className="h-4 w-4" /> Export CSV</Button>} />
      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label className="relative min-w-[180px] flex-1 sm:max-w-xs">
            <span className="sr-only">Search ledger</span>
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-ink-faint" aria-hidden />
            <input className="input pl-8" placeholder="Search player…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} />
          </label>
          <label className="flex items-center gap-2 text-xs text-ink-muted">
            Outcome
            <select className="input w-auto py-1.5" value={outcome} onChange={(e) => { setOutcome(e.target.value); setPage(1) }}>
              <option value="">All trades</option><option value="win">Profitable</option><option value="loss">Losing</option>
            </select>
          </label>
        </div>
        <ErrorBox error={error} onRetry={reload} />
        {loading && !data ? <Spinner /> : !data?.items.length ? (
          <EmptyState icon={<BookOpen className="h-8 w-8" />} title={q || outcome ? 'No matching trades' : 'No completed trades yet'}>Sales you record on Active Transfers are settled into this ledger.</EmptyState>
        ) : (
          <>
            <div className="-mx-4 overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line">
                    <th className="th">Transaction</th>
                    <SortHeader label="Player" k="player" sort={sort} setSort={(s) => { setSort(s); setPage(1) }} />
                    <th className="th">Mode</th>
                    <th className="th text-right">Qty</th>
                    <th className="th text-right">Buy price</th>
                    <th className="th text-right">Sale price</th>
                    <th className="th text-right">Gross</th>
                    <th className="th text-right">Tax</th>
                    <SortHeader label="Net" k="net" sort={sort} setSort={(s) => { setSort(s); setPage(1) }} align="right" />
                    <SortHeader label="Profit" k="profit" sort={sort} setSort={(s) => { setSort(s); setPage(1) }} align="right" />
                    <SortHeader label="ROI" k="roi" sort={sort} setSort={(s) => { setSort(s); setPage(1) }} align="right" />
                    <th className="th">Bought</th>
                    <SortHeader label="Sold" k="sold_at" sort={sort} setSort={(s) => { setSort(s); setPage(1) }} />
                    <th className="th">Held</th>
                    <th className="th">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((e) => (
                    <tr key={e.id} className="border-b border-line/60 last:border-0 hover:bg-panel-2/60" title={e.notes || undefined}>
                      <td className="td num text-xs text-ink-faint">{e.id.slice(0, 8)}</td>
                      <td className="td font-medium">{e.player_name}</td>
                      <td className="td"><ModeBadge mode={e.mode} /></td>
                      <td className="td num text-right">{e.quantity}</td>
                      <td className="td num text-right">{coins(e.purchase_price)}</td>
                      <td className="td num text-right">{coins(e.sale_price)}</td>
                      <td className="td num text-right">{coins(e.gross_proceeds)}</td>
                      <td className="td num text-right text-ink-muted">{coins(e.tax)}</td>
                      <td className="td num text-right">{coins(e.net_proceeds)}</td>
                      <td className={cx('td num text-right font-semibold', pnlClass(e.realised_profit))}>{signedCoins(e.realised_profit)}</td>
                      <td className={cx('td num text-right', pnlClass(e.roi_pct))}>{pct(e.roi_pct)}</td>
                      <td className="td text-xs text-ink-muted">{dateTime(e.purchased_at)}</td>
                      <td className="td text-xs text-ink-muted">{dateTime(e.sold_at)}</td>
                      <td className="td text-xs text-ink-muted">{duration(e.holding_hours)}</td>
                      <td className="td text-xs capitalize text-ink-muted">{e.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  )
}
