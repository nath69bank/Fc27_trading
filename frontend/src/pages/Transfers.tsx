import { useCallback, useEffect, useState } from 'react'
import { ClipboardList, Eye, Plus, Search } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { useApi } from '../lib/useApi'
import { coins, dateTime, duration, parseCoins, pct, pnlClass, signedCoins } from '../lib/format'
import type { MarketCard, Transfer, TransferStatus } from '../lib/types'
import {
  Badge, Button, Card, CoinInput, ConfirmDialog, EmptyState, ErrorBox, Field, ModeBadge, Modal, PageHeader, PlayerChip, SourceBadge, Spinner, useToast, cx,
} from '../components/ui'
import { BuyDialog, SellDialog, type BuyTarget } from '../components/TradeDialogs'
import { announceChange, useRefreshSignal } from '../components/Layout'

const STATUS: Record<TransferStatus, { label: string; cls: string }> = {
  active: { label: 'Active', cls: 'border-info/40 text-info' },
  target_reached: { label: 'Target reached', cls: 'border-profit/40 bg-profit/10 text-profit' },
  listed: { label: 'Listed', cls: 'border-gold/40 text-gold' },
  sold: { label: 'Sold', cls: 'border-line-strong text-ink-muted' },
  cancelled: { label: 'Cancelled', cls: 'border-loss/30 text-loss' },
}
export const StatusBadge = ({ s }: { s: TransferStatus }) => <Badge className={STATUS[s].cls}>{STATUS[s].label}</Badge>

const TABS = [
  { key: 'open', label: 'Open' },
  { key: 'sold', label: 'Sold' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: '', label: 'All' },
]

function UpdateDialog({ transfer, onClose }: { transfer: Transfer | null; onClose: () => void }) {
  const toast = useToast()
  const [est, setEst] = useState('')
  const [target, setTarget] = useState('')
  const [listed, setListed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  useEffect(() => {
    if (!transfer) return
    setEst(transfer.estimated_price ? String(transfer.estimated_price) : '')
    setTarget(String(transfer.target_sell_price))
    setListed(transfer.status === 'listed')
    setError(null)
  }, [transfer])

  async function save() {
    if (!transfer) return
    setBusy(true)
    try {
      const estimate = parseCoins(est)
      await api(`/transfers/${transfer.id}`, {
        method: 'PATCH',
        json: { target_sell_price: parseCoins(target), ...(estimate ? { estimated_price: estimate } : { clear_estimate: true }), status: listed ? 'listed' : 'active' },
      })
      toast('success', 'Transfer updated.')
      announceChange()
      onClose()
    } catch (e) {
      setError(e as ApiError)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={Boolean(transfer)} onClose={onClose} title={`Update ${transfer?.player_name ?? ''}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} loading={busy}>Save</Button></>}>
      <div className="space-y-3">
        <ErrorBox error={error} />
        <Field label="Your current price estimate" hint="Overrides the latest market observation if it is newer. Leave blank to use market data.">{(id) => <CoinInput id={id} value={est} onChange={setEst} autoFocus />}</Field>
        <Field label="Target sell price">{(id) => <CoinInput id={id} value={target} onChange={setTarget} />}</Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={listed} onChange={(e) => setListed(e.target.checked)} className="h-4 w-4 accent-[#f5c451]" />
          Listed on the transfer market
        </label>
      </div>
    </Modal>
  )
}

function DetailDialog({ transfer, onClose }: { transfer: Transfer | null; onClose: () => void }) {
  if (!transfer) return null
  const t = transfer
  const rows: [string, React.ReactNode][] = [
    ['Transfer ID', <span className="num text-xs">{t.id}</span>],
    ['Mode', <ModeBadge mode={t.mode} />],
    ['Status', <StatusBadge s={t.status} />],
    ['Purchase price', coins(t.purchase_price)],
    ['Quantity purchased / remaining', `${t.quantity_purchased} / ${t.quantity_remaining}`],
    ['Original cost', coins(t.original_cost)],
    ['Invested (remaining)', coins(t.total_invested)],
    ['Target sell price', coins(t.target_sell_price)],
    ['Expected net proceeds', coins(t.expected_net_proceeds)],
    ['Expected tax', coins(t.expected_tax)],
    ['Break-even resale', coins(t.break_even_sell)],
    ['Expected profit', <span className={pnlClass(t.expected_profit)}>{signedCoins(t.expected_profit)} ({pct(t.expected_roi_pct)})</span>],
    ['Current estimated price', <span className="inline-flex items-center gap-1">{coins(t.current_price)} <SourceBadge source={t.current_price_source} /></span>],
    ['Realised profit so far', <span className={pnlClass(t.realised_profit)}>{signedCoins(t.realised_profit)}</span>],
    ['Purchased', dateTime(t.purchased_at)],
    ['Closed', dateTime(t.closed_at)],
    ['Holding duration', duration(t.holding_hours)],
  ]
  return (
    <Modal open onClose={onClose} title={`Transfer — ${t.player_name}`} wide>
      <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-2 border-b border-line/50 py-1"><dt className="text-ink-muted">{k}</dt><dd className="num text-right">{v}</dd></div>
        ))}
      </dl>
      {t.notes && <p className="mt-3 text-sm text-ink-muted">Notes: {t.notes}</p>}
      <h3 className="mb-2 mt-5 text-sm font-semibold">Settlements</h3>
      {t.sales.length ? (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className="border-b border-line"><th className="th">Sold</th><th className="th text-right">Qty</th><th className="th text-right">Price</th><th className="th text-right">Tax</th><th className="th text-right">Net</th><th className="th text-right">Profit</th></tr></thead>
            <tbody>{t.sales.map((s) => (
              <tr key={s.id} className="border-b border-line/50"><td className="td">{dateTime(s.sold_at)}</td><td className="td num text-right">{s.quantity}</td><td className="td num text-right">{coins(s.sale_price)}</td><td className="td num text-right">{coins(s.tax)}</td><td className="td num text-right">{coins(s.net_proceeds)}</td><td className={cx('td num text-right', pnlClass(s.realised_profit))}>{signedCoins(s.realised_profit)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      ) : <p className="text-sm text-ink-muted">No sales recorded yet.</p>}
    </Modal>
  )
}

function NewPurchase({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (t: BuyTarget) => void }) {
  const cards = useApi<MarketCard[]>(open ? '/market/cards' : null, [open])
  const [name, setName] = useState('')
  useEffect(() => { if (open) setName('') }, [open])
  const match = cards.data?.find((c) => c.player_name.toLowerCase() === name.trim().toLowerCase())
  return (
    <Modal open={open} onClose={onClose} title="New purchase"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!name.trim()} onClick={() => { onPick({ cardId: match?.id, playerName: match?.player_name ?? name.trim(), price: match?.stats.latest_price, isSimulatedData: match?.stats.is_simulated }); onClose() }}>Continue</Button></>}>
      <Field label="Player" hint="Pick a tracked card or type a new name">
        {(id) => (
          <>
            <input id={id} className="input" list="cards-list" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            <datalist id="cards-list">{cards.data?.map((c) => <option key={c.id} value={c.player_name} />)}</datalist>
          </>
        )}
      </Field>
    </Modal>
  )
}

export default function Transfers() {
  const toast = useToast()
  const [tab, setTab] = useState('open')
  const [q, setQ] = useState('')
  const { data, error, loading, reload } = useApi<Transfer[]>(`/transfers?${tab ? `status=${tab}&` : ''}${q ? `q=${encodeURIComponent(q)}` : ''}`)
  useRefreshSignal(useCallback(() => void reload(), [reload]))
  const [selling, setSelling] = useState<Transfer | null>(null)
  const [updating, setUpdating] = useState<Transfer | null>(null)
  const [viewing, setViewing] = useState<Transfer | null>(null)
  const [cancelling, setCancelling] = useState<Transfer | null>(null)
  const [cancelBusy, setCancelBusy] = useState(false)
  const [picker, setPicker] = useState(false)
  const [buy, setBuy] = useState<BuyTarget | null>(null)

  async function cancel() {
    if (!cancelling) return
    setCancelBusy(true)
    try {
      await api(`/transfers/${cancelling.id}/cancel`, { method: 'POST', json: { reason: 'Cancelled from Active Transfers' } })
      toast('success', `Cancelled. ${coins(cancelling.total_invested)} coins returned to available.`)
      setCancelling(null)
      announceChange()
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      setCancelBusy(false)
    }
  }

  const open = data?.filter((t) => ['active', 'target_reached', 'listed'].includes(t.status)) ?? []
  return (
    <>
      <PageHeader title="Active Transfers" subtitle="Every purchase gets its own ID, so several cards of the same player are tracked separately. Expected figures are after 5% tax and not guaranteed."
        actions={<Button variant="primary" onClick={() => setPicker(true)}><Plus className="h-4 w-4" /> New purchase</Button>} />
      {tab === 'open' && data && open.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="card p-3"><p className="text-[11px] uppercase tracking-wide text-ink-muted">Open positions</p><p className="num mt-1 text-lg font-semibold">{open.length}</p></div>
          <div className="card p-3"><p className="text-[11px] uppercase tracking-wide text-ink-muted">Invested</p><p className="num mt-1 text-lg font-semibold">{coins(open.reduce((a, t) => a + t.total_invested, 0))}</p></div>
          <div className="card p-3"><p className="text-[11px] uppercase tracking-wide text-ink-muted">Current value</p><p className="num mt-1 text-lg font-semibold">{coins(open.reduce((a, t) => a + t.current_value, 0))}</p></div>
          <div className="card p-3"><p className="text-[11px] uppercase tracking-wide text-ink-muted">Unrealised (after tax)</p>{(() => { const u = open.reduce((a, t) => a + t.unrealised_profit, 0); return <p className={cx('num mt-1 text-lg font-semibold', pnlClass(u))}>{signedCoins(u)}</p> })()}</div>
        </div>
      )}
      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div role="tablist" className="flex gap-1 rounded-lg border border-line bg-panel-2 p-1">
            {TABS.map((t) => (
              <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} className={cx('rounded-md px-3 py-1 text-sm', tab === t.key ? 'bg-panel-3 text-ink' : 'text-ink-muted hover:text-ink')}>{t.label}</button>
            ))}
          </div>
          <label className="relative ml-auto min-w-[180px] flex-1 sm:max-w-xs">
            <span className="sr-only">Search transfers</span>
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-ink-faint" aria-hidden />
            <input className="input pl-8" placeholder="Search player…" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        </div>
        <ErrorBox error={error} onRetry={reload} />
        {loading && !data ? <Spinner /> : !data?.length ? (
          <EmptyState icon={<ClipboardList className="h-8 w-8" />} title="No transfers here" action={tab === 'open' && <Button variant="primary" onClick={() => setPicker(true)}>Record a purchase</Button>}>
            Buy from a BUY signal on the scanner, or record a purchase you made in-game.
          </EmptyState>
        ) : (
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line">
                  <th className="th">Player</th><th className="th">Status</th><th className="th text-right">Buy price</th><th className="th text-right">Qty</th>
                  <th className="th text-right">Invested</th><th className="th text-right">Target sell</th><th className="th text-right" title="Lowest sale price that recovers the purchase price after tax">Break-even</th><th className="th text-right">Current est.</th>
                  <th className="th text-right">Exp. net</th><th className="th text-right">Exp. profit</th><th className="th text-right">Exp. ROI</th>
                  <th className="th">Purchased</th><th className="th">Held</th><th className="th text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.map((t) => {
                  const isOpen = ['active', 'target_reached', 'listed'].includes(t.status)
                  return (
                    <tr key={t.id} className={cx('border-b border-line/60 last:border-0 hover:bg-panel-2/60', t.status === 'target_reached' && 'bg-profit/[0.04]')}>
                      <td className="td"><div className="flex items-center gap-2"><PlayerChip name={t.player_name} rating={t.card.rating} position={t.card.position} version={t.card.version} image={t.card.image_url} />{t.mode === 'simulation' && <Badge className="border-gold/40 text-gold">SIM</Badge>}</div></td>
                      <td className="td"><StatusBadge s={t.status} /></td>
                      <td className="td num text-right">{coins(t.purchase_price)}</td>
                      <td className="td num text-right">{t.quantity_remaining}{t.quantity_sold > 0 && <span className="text-ink-faint">/{t.quantity_purchased}</span>}</td>
                      <td className="td num text-right">{coins(t.total_invested)}</td>
                      <td className="td num text-right">{coins(t.target_sell_price)}</td>
                      <td className={cx('td num text-right', t.current_price < t.break_even_sell ? 'text-loss' : 'text-ink-muted')} title={t.current_price < t.break_even_sell ? 'Selling at the current estimate would lose coins after tax' : undefined}>{coins(t.break_even_sell)}</td>
                      <td className="td text-right"><div className="num">{coins(t.current_price)}</div><div className="mt-0.5 flex justify-end"><SourceBadge source={t.current_price_source} /></div></td>
                      <td className="td num text-right">{coins(t.expected_net_proceeds)}</td>
                      <td className={cx('td num text-right font-medium', pnlClass(t.expected_profit))}>{signedCoins(t.expected_profit)}</td>
                      <td className={cx('td num text-right', pnlClass(t.expected_roi_pct))}>{pct(t.expected_roi_pct)}</td>
                      <td className="td text-xs text-ink-muted">{dateTime(t.purchased_at)}</td>
                      <td className="td text-xs text-ink-muted">{duration(t.holding_hours)}</td>
                      <td className="td">
                        <div className="flex justify-end gap-1">
                          {isOpen && <Button size="sm" variant="primary" onClick={() => setSelling(t)}>Record sale</Button>}
                          {isOpen && <Button size="sm" onClick={() => setUpdating(t)}>Update</Button>}
                          {isOpen && <Button size="sm" variant="ghost" className="text-loss" onClick={() => setCancelling(t)}>Cancel</Button>}
                          <Button size="sm" variant="ghost" onClick={() => setViewing(t)} aria-label="View details"><Eye className="h-3.5 w-3.5" /></Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <SellDialog transfer={selling} onClose={() => setSelling(null)} />
      <UpdateDialog transfer={updating} onClose={() => setUpdating(null)} />
      <DetailDialog transfer={viewing} onClose={() => setViewing(null)} />
      <ConfirmDialog open={Boolean(cancelling)} danger title="Cancel this transfer?" confirmLabel="Cancel transfer" busy={cancelBusy} onClose={() => setCancelling(null)} onConfirm={cancel}
        message={<>The remaining {cancelling?.quantity_remaining} card(s) of <strong className="text-ink">{cancelling?.player_name}</strong> are closed and {coins(cancelling?.total_invested)} coins return to available. Recorded sales stay in the ledger. This cannot be undone.</>} />
      <NewPurchase open={picker} onClose={() => setPicker(false)} onPick={setBuy} />
      <BuyDialog target={buy} onClose={() => setBuy(null)} />
    </>
  )
}
