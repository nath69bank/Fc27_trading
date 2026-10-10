import { useEffect, useMemo, useState } from 'react'
import { api, ApiError, newRequestId } from '../lib/api'
import { coins, parseCoins, pct, pnlClass, signedCoins } from '../lib/format'
import type { Settings, Transfer } from '../lib/types'
import { Button, CoinInput, ErrorBox, Field, ModeBadge, Modal, Notice, useToast } from './ui'
import { announceChange } from './Layout'

interface PurchasePlan {
  ok: boolean
  code?: string
  message?: string
  total_cost?: number
  available_before?: number
  available_after?: number
  invested_before?: number
  invested_after?: number
}

export interface BuyTarget {
  cardId?: string
  playerName: string
  price?: number | null
  targetSell?: number | null
  isSimulatedData?: boolean | null
}

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/** execute_purchase(): review → confirm. The server validates and computes balances. */
export function BuyDialog({ target, onClose, onDone }: { target: BuyTarget | null; onClose: () => void; onDone?: (t: Transfer) => void }) {
  const toast = useToast()
  const [price, setPrice] = useState('')
  const [qty, setQty] = useState('1')
  const [sell, setSell] = useState('')
  const [mode, setMode] = useState<'simulation' | 'manual'>('simulation')
  const [notes, setNotes] = useState('')
  const [when, setWhen] = useState('')
  const [plan, setPlan] = useState<PurchasePlan | null>(null)
  const [step, setStep] = useState<'edit' | 'confirm'>('edit')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const requestId = useMemo(() => (target ? newRequestId() : ''), [target])

  useEffect(() => {
    if (!target) return
    setPrice(target.price ? String(target.price) : '')
    setSell(target.targetSell ? String(target.targetSell) : '')
    setQty('1')
    setNotes('')
    setWhen('')
    setStep('edit')
    setError(null)
    setPlan(null)
    api<Settings>('/settings').then((s) => setMode(s.mode)).catch(() => {})
  }, [target])

  const unit = parseCoins(price)
  const quantity = parseInt(qty, 10)
  const sellPrice = parseCoins(sell)
  const debounced = useDebounced(`${unit}|${quantity}`)

  useEffect(() => {
    if (!target || !unit || !quantity || quantity < 1) {
      setPlan(null)
      return
    }
    api<PurchasePlan>('/transfers/preview', { method: 'POST', json: { unit_price: unit, quantity, card_id: target.cardId } })
      .then(setPlan)
      .catch((e) => setPlan({ ok: false, message: e.message }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, target])

  const formError =
    !unit ? 'Enter a purchase price.' : !quantity || quantity < 1 || quantity > 100 ? 'Quantity must be 1–100.' : !sellPrice ? 'Enter a target sell price.' : null

  async function submit() {
    if (!target || !unit || !sellPrice) return
    setBusy(true)
    setError(null)
    try {
      const t = await api<Transfer & { replayed: boolean }>('/transfers', {
        method: 'POST',
        json: {
          idempotency_key: requestId,
          card_id: target.cardId,
          player_name: target.cardId ? undefined : target.playerName,
          unit_price: unit,
          quantity,
          target_sell_price: sellPrice,
          mode,
          notes,
          purchased_at: mode === 'manual' && when ? new Date(when).toISOString() : undefined,
        },
      })
      toast('success', `${mode === 'simulation' ? 'Simulated purchase' : 'Purchase recorded'}: ${quantity} × ${target.playerName} for ${coins(unit * quantity)} coins.`)
      announceChange()
      onDone?.(t)
      onClose()
    } catch (e) {
      setError(e as ApiError)
      setStep('edit')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={Boolean(target)}
      onClose={onClose}
      title={step === 'confirm' ? 'Confirm purchase' : `Buy ${target?.playerName ?? ''}`}
      footer={
        step === 'edit' ? (
          <>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={Boolean(formError) || !plan?.ok} onClick={() => setStep('confirm')}>Review purchase</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setStep('edit')}>Back</Button>
            <Button variant="primary" loading={busy} onClick={submit}>{mode === 'simulation' ? 'Confirm simulated buy' : 'Record purchase'}</Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        <ErrorBox error={error} />
        {step === 'edit' ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Price per card">{(id) => <CoinInput id={id} value={price} onChange={setPrice} placeholder="25,200" autoFocus />}</Field>
              <Field label="Quantity">{(id) => <input id={id} className="input num" type="number" min={1} max={100} value={qty} onChange={(e) => setQty(e.target.value)} />}</Field>
              <Field label="Target sell price" hint="Per card, before 5% tax">{(id) => <CoinInput id={id} value={sell} onChange={setSell} placeholder="32,000" />}</Field>
              <Field label="Mode">
                {(id) => (
                  <select id={id} className="input" value={mode} onChange={(e) => setMode(e.target.value as 'simulation' | 'manual')}>
                    <option value="simulation">Simulation (virtual coins)</option>
                    <option value="manual">Manual tracking (real in-game buy)</option>
                  </select>
                )}
              </Field>
            </div>
            {mode === 'manual' && (
              <Field label="Purchased at (optional)" hint="Leave blank for now">
                {(id) => <input id={id} type="datetime-local" className="input" value={when} onChange={(e) => setWhen(e.target.value)} />}
              </Field>
            )}
            <Field label="Notes (optional)">{(id) => <input id={id} className="input" value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />}</Field>
            {plan && !plan.ok && unit && <ErrorBox error={{ message: plan.message ?? 'Purchase not allowed.' }} />}
            {plan?.ok && <PlanSummary plan={plan} />}
          </>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <span className="text-sm text-ink-muted">{quantity} × {target?.playerName} @ <span className="num text-ink">{coins(unit)}</span></span>
              <ModeBadge mode={mode} />
            </div>
            {plan?.ok && <PlanSummary plan={plan} />}
            <Notice tone={mode === 'simulation' ? 'demo' : 'info'}>
              {mode === 'simulation'
                ? 'This is a virtual trade with simulated coins. Nothing happens in FC 27.'
                : 'This records a purchase you made yourself in FC 27. The app does not place transfers.'}
              {target?.isSimulatedData && ' The price signal behind this trade uses simulated/demo data.'}
            </Notice>
          </>
        )}
      </div>
    </Modal>
  )
}

function PlanSummary({ plan }: { plan: PurchasePlan }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg border border-line bg-panel-2 p-3 text-sm">
      <dt className="text-ink-muted">Total purchase cost</dt>
      <dd className="num text-right font-semibold">{coins(plan.total_cost)}</dd>
      <dt className="text-ink-muted">Available coins</dt>
      <dd className="num text-right">{coins(plan.available_before)} → <span className="text-ink">{coins(plan.available_after)}</span></dd>
      <dt className="text-ink-muted">Invested coins</dt>
      <dd className="num text-right">{coins(plan.invested_before)} → <span className="text-ink">{coins(plan.invested_after)}</span></dd>
    </dl>
  )
}

interface SalePreview {
  ok: boolean
  code?: string
  message?: string
  gross?: number
  tax?: number
  net?: number
  purchase_cost?: number
  realised_profit?: number
  roi_pct?: number
  quantity_remaining_after?: number
}

/** track_and_settle(): record a full or partial sale. */
export function SellDialog({ transfer, onClose }: { transfer: Transfer | null; onClose: () => void }) {
  const toast = useToast()
  const [price, setPrice] = useState('')
  const [qty, setQty] = useState('1')
  const [when, setWhen] = useState('')
  const [notes, setNotes] = useState('')
  const [preview, setPreview] = useState<SalePreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const requestId = useMemo(() => (transfer ? newRequestId() : ''), [transfer])

  useEffect(() => {
    if (!transfer) return
    setPrice(String(transfer.target_sell_price))
    setQty(String(transfer.quantity_remaining))
    setWhen('')
    setNotes('')
    setError(null)
  }, [transfer])

  const sale = parseCoins(price)
  const quantity = parseInt(qty, 10)
  const debounced = useDebounced(`${sale}|${quantity}`)
  useEffect(() => {
    if (!transfer || !sale || !quantity) {
      setPreview(null)
      return
    }
    api<SalePreview>(`/transfers/${transfer.id}/sell/preview`, { method: 'POST', json: { sale_price: sale, quantity } })
      .then(setPreview)
      .catch((e) => setPreview({ ok: false, message: e.message }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, transfer])

  async function submit() {
    if (!transfer || !sale) return
    setBusy(true)
    setError(null)
    try {
      const e = await api<{ realised_profit: number; replayed: boolean }>(`/transfers/${transfer.id}/sell`, {
        method: 'POST',
        json: { idempotency_key: requestId, sale_price: sale, quantity, notes, sold_at: when ? new Date(when).toISOString() : undefined },
      })
      toast(e.realised_profit >= 0 ? 'success' : 'info', `Sale settled: ${signedCoins(e.realised_profit)} coins realised${e.replayed ? ' (already recorded)' : ''}.`)
      announceChange()
      onClose()
    } catch (err) {
      setError(err as ApiError)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={Boolean(transfer)}
      onClose={onClose}
      title={`Record sale — ${transfer?.player_name ?? ''}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!preview?.ok} onClick={submit}>Settle sale</Button>
        </>
      }
    >
      {transfer && (
        <div className="space-y-4">
          <ErrorBox error={error} />
          <p className="text-xs text-ink-muted">
            Bought {transfer.quantity_purchased} @ <span className="num">{coins(transfer.purchase_price)}</span> · {transfer.quantity_remaining} remaining · ID <span className="num">{transfer.id.slice(0, 8)}</span>
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Actual sale price per card">{(id) => <CoinInput id={id} value={price} onChange={setPrice} autoFocus />}</Field>
            <Field label={`Quantity sold (max ${transfer.quantity_remaining})`}>
              {(id) => <input id={id} className="input num" type="number" min={1} max={transfer.quantity_remaining} value={qty} onChange={(e) => setQty(e.target.value)} />}
            </Field>
            <Field label="Sale date (optional)">{(id) => <input id={id} type="datetime-local" className="input" value={when} onChange={(e) => setWhen(e.target.value)} />}</Field>
            <Field label="Notes (optional)">{(id) => <input id={id} className="input" value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />}</Field>
          </div>
          {preview && !preview.ok && <ErrorBox error={{ message: preview.message ?? 'Sale not allowed.' }} />}
          {preview?.ok && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg border border-line bg-panel-2 p-3 text-sm">
              <dt className="text-ink-muted">Gross sale proceeds</dt><dd className="num text-right">{coins(preview.gross)}</dd>
              <dt className="text-ink-muted">Transfer market tax</dt><dd className="num text-right text-loss">−{coins(preview.tax)}</dd>
              <dt className="text-ink-muted">Net sale proceeds</dt><dd className="num text-right font-semibold">{coins(preview.net)}</dd>
              <dt className="text-ink-muted">Purchase cost of cards sold</dt><dd className="num text-right">{coins(preview.purchase_cost)}</dd>
              <dt className="text-ink-muted">Realised profit</dt>
              <dd className={`num text-right font-semibold ${pnlClass(preview.realised_profit)}`}>{signedCoins(preview.realised_profit)} <span className="text-xs">({pct(preview.roi_pct)})</span></dd>
              {(preview.quantity_remaining_after ?? 0) > 0 && (<><dt className="text-ink-muted">Cards left on transfer</dt><dd className="num text-right">{preview.quantity_remaining_after}</dd></>)}
            </dl>
          )}
        </div>
      )}
    </Modal>
  )
}
