import { useEffect, useState } from 'react'
import { ExternalLink, Search } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { coins, parseCoins } from '../lib/format'
import type { CardInfo, SeenOn } from '../lib/types'
import { Button, CoinInput, ErrorBox, Field, Modal, Notice, useToast, cx } from './ui'
import { announceChange } from './Layout'

export const SEEN_ON_LABEL: Record<SeenOn, string> = {
  ingame: 'In-game market',
  futbin: 'FUTBIN',
  futgg: 'FUT.GG',
  other: 'Other',
}

const SITES = [
  { key: 'futbin_url' as const, label: 'FUTBIN', host: 'futbin.com' },
  { key: 'futgg_url' as const, label: 'FUT.GG', host: 'fut.gg' },
]

/** Search the site for this card when the user hasn't saved its page yet. */
function searchUrl(card: CardInfo, host: string) {
  const q = [card.player_name, card.version, card.rating].filter(Boolean).join(' ')
  return `https://www.google.com/search?q=${encodeURIComponent(`site:${host} ${q}`)}`
}

/**
 * Links to the player's pages on FUTBIN and FUT.GG. Neither site offers a public API, so the
 * app only links out: it never fetches their prices or images.
 */
export function SiteLinks({ card, size = 'sm' }: { card: CardInfo; size?: 'sm' | 'md' }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {SITES.map(({ key, label, host }) => {
        const saved = card[key]
        return (
          <a
            key={key}
            href={saved ?? searchUrl(card, host)}
            target="_blank"
            rel="noopener noreferrer"
            title={saved ? `Open ${card.player_name} on ${label}` : `Search ${label} for ${card.player_name} (no page saved yet)`}
            className={cx(
              'inline-flex items-center gap-1 rounded-md border font-medium transition-colors',
              size === 'sm' ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1.5 text-xs',
              saved ? 'border-line-strong bg-panel-2 text-ink hover:border-ink-faint' : 'border-dashed border-line text-ink-muted hover:text-ink',
            )}
          >
            {saved ? <ExternalLink className="h-3 w-3" aria-hidden /> : <Search className="h-3 w-3" aria-hidden />}
            {label}
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        )
      })}
    </div>
  )
}

function siteError(value: string, host: string, label: string) {
  if (!value.trim()) return null
  try {
    const u = new URL(value.trim())
    const h = u.hostname.toLowerCase()
    if (u.protocol === 'https:' && (h === host || h.endsWith('.' + host))) return null
  } catch {
    /* fall through */
  }
  return `Paste the player's page from ${label}, e.g. https://www.${host}/…`
}

/** Edit a card's picture, position and FUTBIN / FUT.GG links. */
export function CardEditDialog({ card, onClose, onSaved }: { card: CardInfo | null; onClose: () => void; onSaved?: () => void }) {
  const toast = useToast()
  const [f, setF] = useState({ image_url: '', position: '', futbin_url: '', futgg_url: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  useEffect(() => {
    if (!card) return
    setF({ image_url: card.image_url ?? '', position: card.position ?? '', futbin_url: card.futbin_url ?? '', futgg_url: card.futgg_url ?? '' })
    setError(null)
  }, [card])
  const binErr = siteError(f.futbin_url, 'futbin.com', 'FUTBIN')
  const ggErr = siteError(f.futgg_url, 'fut.gg', 'FUT.GG')

  async function save() {
    if (!card || binErr || ggErr) return
    setBusy(true)
    setError(null)
    try {
      await api(`/market/cards/${card.id}`, { method: 'PATCH', json: f })
      toast('success', `${card.player_name} updated.`)
      announceChange()
      onSaved?.()
      onClose()
    } catch (e) {
      setError(e as ApiError)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={Boolean(card)} onClose={onClose} title={`Card details: ${card?.player_name ?? ''}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} loading={busy} disabled={Boolean(binErr || ggErr)}>Save</Button></>}>
      <div className="space-y-3">
        <ErrorBox error={error} />
        <Field label="FUTBIN page" error={binErr} hint="Open the player on FUTBIN and paste the address here">
          {(id) => <input id={id} className="input" type="url" inputMode="url" placeholder="https://www.futbin.com/…" value={f.futbin_url} onChange={(e) => setF({ ...f, futbin_url: e.target.value })} autoFocus />}
        </Field>
        <Field label="FUT.GG page" error={ggErr}>
          {(id) => <input id={id} className="input" type="url" inputMode="url" placeholder="https://www.fut.gg/players/…" value={f.futgg_url} onChange={(e) => setF({ ...f, futgg_url: e.target.value })} />}
        </Field>
        <div className="grid grid-cols-[1fr_96px] gap-2">
          <Field label="Card image URL" hint="Use an image you have the right to use">
            {(id) => <input id={id} className="input" type="url" placeholder="https://…" value={f.image_url} onChange={(e) => setF({ ...f, image_url: e.target.value })} />}
          </Field>
          <Field label="Position">
            {(id) => <input id={id} className="input" maxLength={8} value={f.position} onChange={(e) => setF({ ...f, position: e.target.value.toUpperCase() })} />}
          </Field>
        </div>
        <Notice>FUTBIN and FUT.GG don't offer a public API, so these are shortcuts only. The app never downloads their prices or images; record the prices you see with <strong>Seen on</strong>.</Notice>
      </div>
    </Modal>
  )
}

export function SeenOnSelect({ id, value, onChange }: { id: string; value: SeenOn; onChange: (v: SeenOn) => void }) {
  return (
    <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value as SeenOn)}>
      {(Object.keys(SEEN_ON_LABEL) as SeenOn[]).map((k) => <option key={k} value={k}>{SEEN_ON_LABEL[k]}</option>)}
    </select>
  )
}

/** Record a price you just read somewhere, tagged with where you saw it. */
export function QuickPriceDialog({ card, onClose }: { card: CardInfo | null; onClose: () => void }) {
  const toast = useToast()
  const [price, setPrice] = useState('')
  const [seen, setSeen] = useState<SeenOn>('ingame')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  useEffect(() => {
    if (card) { setPrice(''); setError(null) }
  }, [card])

  async function save() {
    const p = parseCoins(price)
    if (!card || !p) return
    setBusy(true)
    try {
      await api('/market/prices', { method: 'POST', json: { card_id: card.id, price: p, seen_on: seen } })
      toast('success', `Recorded ${coins(p)} for ${card.player_name} (seen on ${SEEN_ON_LABEL[seen]}).`)
      announceChange()
      onClose()
    } catch (e) {
      setError(e as ApiError)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open={Boolean(card)} onClose={onClose} title={`Record price: ${card?.player_name ?? ''}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} loading={busy} disabled={!parseCoins(price)}>Record price</Button></>}>
      <div className="space-y-3">
        <ErrorBox error={error} />
        <div className="grid grid-cols-2 gap-2">
          <Field label="Price">{(id) => <CoinInput id={id} value={price} onChange={setPrice} autoFocus />}</Field>
          <Field label="Seen on">{(id) => <SeenOnSelect id={id} value={seen} onChange={setSeen} />}</Field>
        </div>
        {card && <div><p className="label">Check the sites</p><SiteLinks card={card} size="md" /></div>}
      </div>
    </Modal>
  )
}
