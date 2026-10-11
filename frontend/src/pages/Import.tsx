import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Camera, CheckCircle2, ScanText } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { useApi } from '../lib/useApi'
import { parseCoins } from '../lib/format'
import type { ExtractedRow, Extraction, ImportSite, ImportStatus } from '../lib/types'
import { Badge, Button, Card, ErrorBox, Notice, PageHeader, Spinner, useToast, cx } from '../components/ui'
import { announceChange } from '../components/Layout'

const SITE_LABEL: Record<ImportSite, string> = { futbin: 'FUTBIN', futgg: 'FUT.GG', ingame: 'In-game market', discord: 'Trading group post', other: 'Other' }
const MAX_SIDE = 2400

interface Row extends ExtractedRow {
  include: boolean
  priceText: string
}

/** Downscale very large screenshots in the browser so uploads stay small but legible. */
async function prepareImage(file: File): Promise<{ base64: string; mediaType: string; preview: string }> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('That file is not an image we can read.'))
      el.src = url
    })
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
    const needsResize = scale < 1 || file.size > 3_500_000 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)
    if (!needsResize) {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result))
        r.onerror = () => reject(new Error('Could not read the file.'))
        r.readAsDataURL(file)
      })
      return { base64: dataUrl.split(',')[1], mediaType: file.type, preview: dataUrl }
    }
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.naturalWidth * scale)
    canvas.height = Math.round(img.naturalHeight * scale)
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
    return { base64: dataUrl.split(',')[1], mediaType: 'image/jpeg', preview: dataUrl }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export default function Import() {
  const toast = useToast()
  const status = useApi<ImportStatus>('/import/status')
  const [image, setImage] = useState<{ base64: string; mediaType: string; preview: string } | null>(null)
  const [reading, setReading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<ApiError | { message: string } | null>(null)
  const [result, setResult] = useState<Extraction | null>(null)
  const [site, setSite] = useState<ImportSite>('futbin')
  const [rows, setRows] = useState<Row[]>([])
  const [saved, setSaved] = useState<number | null>(null)

  useEffect(() => {
    if (!result) return
    setSite(result.site)
    setRows(result.items.map((it) => ({
      ...it,
      priceText: it.price ? String(it.price) : '',
      include: Boolean(it.price) && it.confidence !== 'low' && (it.platform === 'unknown' || it.platform === result.your_platform),
    })))
  }, [result])

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    setResult(null)
    setSaved(null)
    try {
      setImage(await prepareImage(file))
    } catch (err) {
      setError({ message: (err as Error).message })
    }
  }

  async function read() {
    if (!image) return
    setReading(true)
    setError(null)
    try {
      setResult(await api<Extraction>('/import/screenshot', { method: 'POST', json: { image_base64: image.base64, media_type: image.mediaType } }))
      void status.reload()
    } catch (err) {
      setError(err as ApiError)
      void status.reload()
    } finally {
      setReading(false)
    }
  }

  const chosen = rows.filter((r) => r.include && parseCoins(r.priceText))
  async function save() {
    setSaving(true)
    setError(null)
    try {
      const r = await api<{ saved: number; skipped: { error: string }[] }>('/import/screenshot/commit', {
        method: 'POST',
        json: {
          site,
          rows: chosen.map((x) => ({ player_name: x.player_name.trim(), rating: x.rating, position: x.position, card_type: x.card_type, price: parseCoins(x.priceText), platform: x.platform })),
        },
      })
      setSaved(r.saved)
      toast('success', `Saved ${r.saved} console price${r.saved === 1 ? '' : 's'} from ${SITE_LABEL[site]}.`)
      if (r.skipped.length) toast('info', r.skipped.map((s) => s.error).join(' '))
      announceChange()
    } catch (err) {
      setError(err as ApiError)
    } finally {
      setSaving(false)
    }
  }

  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const s = status.data
  return (
    <>
      <PageHeader
        title="Screenshot Import"
        subtitle="Screenshot a FUTBIN or FUT.GG page, the in-game transfer market, or a price card from your trading group. Claude reads the players and prices, you check them, and they're saved as console prices."
      />
      {s && !s.configured && (
        <div className="mb-4"><Notice tone="warn">Screenshot reading isn't switched on for this site yet. It needs an Anthropic API key set as <code>ANTHROPIC_API_KEY</code> in the deployment's environment variables.</Notice></div>
      )}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
        <Card title="1. Choose a screenshot" subtitle={s ? `${s.remaining_today} of ${s.daily_limit} reads left today` : undefined}>
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong px-4 py-8 text-center text-sm text-ink-muted hover:border-info hover:text-ink">
            <Camera className="h-6 w-6" aria-hidden />
            <span><strong className="text-ink">Choose or take a screenshot</strong><br />PNG or JPEG, up to 5 MB</span>
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" onChange={onFile} />
          </label>
          {image && (
            <div className="mt-3 space-y-3">
              <img src={image.preview} alt="Screenshot to read" className="max-h-96 w-full rounded-lg border border-line object-contain" />
              <Button variant="primary" className="w-full" onClick={read} loading={reading} disabled={!s?.configured || s.remaining_today === 0}>
                <ScanText className="h-4 w-4" /> {reading ? 'Reading prices…' : 'Read prices'}
              </Button>
            </div>
          )}
          <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">The image is sent to Claude to read and is not stored. Only the rows you confirm are saved.</p>
        </Card>

        <Card title="2. Check and save" subtitle={result ? `${rows.length} player${rows.length === 1 ? '' : 's'} found${result.notes ? ` · ${result.notes}` : ''}` : 'Results appear here'}>
          <ErrorBox error={error} />
          {reading ? <Spinner label="Reading the screenshot…" /> : !result ? (
            <p className="py-8 text-center text-sm text-ink-muted">Choose a screenshot and press <strong>Read prices</strong>.</p>
          ) : !rows.length ? (
            <p className="py-8 text-center text-sm text-ink-muted">No player prices found in that screenshot.</p>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                <label htmlFor="imp-site" className="text-ink-muted">Seen on</label>
                <select id="imp-site" className="input w-auto py-1.5" value={site} onChange={(e) => setSite(e.target.value as ImportSite)}>
                  {(Object.keys(SITE_LABEL) as ImportSite[]).map((k) => <option key={k} value={k}>{SITE_LABEL[k]}</option>)}
                </select>
                {result.platform === 'pc' && <Badge className="border-warn/40 text-warn">PC prices: not your console market</Badge>}
              </div>
              <div className="-mx-4 overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-line">
                      <th className="th w-8"><span className="sr-only">Save</span></th><th className="th">Player</th><th className="th">Card</th>
                      <th className="th text-right">Price</th><th className="th">Market</th><th className="th">Read</th><th className="th">Tracked as</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} className={cx('border-b border-line/60 last:border-0', !r.include && 'opacity-50')}>
                        <td className="td"><input type="checkbox" className="h-4 w-4 accent-[#2bd576]" checked={r.include} onChange={(e) => update(i, { include: e.target.checked })} aria-label={`Save ${r.player_name}`} /></td>
                        <td className="td"><input className="input w-40 py-1 text-sm" value={r.player_name} onChange={(e) => update(i, { player_name: e.target.value })} aria-label="Player name" /></td>
                        <td className="td text-xs text-ink-muted">{[r.rating, r.position, r.card_type].filter(Boolean).join(' · ') || '—'}</td>
                        <td className="td text-right"><input className="input num w-24 py-1 text-right text-sm" inputMode="numeric" value={r.priceText} onChange={(e) => update(i, { priceText: e.target.value.replace(/[^\d,]/g, '') })} aria-label={`Price for ${r.player_name}`} /></td>
                        <td className="td text-xs">{r.platform === 'unknown' ? <span className="text-ink-faint">not shown</span> : r.platform === 'console' ? 'Console' : <span className="text-warn">PC</span>}</td>
                        <td className="td"><Badge className={r.confidence === 'high' ? 'border-profit/40 text-profit' : r.confidence === 'medium' ? 'border-warn/40 text-warn' : 'border-loss/40 text-loss'}>{r.confidence}</Badge></td>
                        <td className="td text-xs text-ink-muted">{r.matched_card_name ? <span className="text-ink">{r.matched_card_name}</span> : 'new card'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-ink-muted">Check each price against the screenshot: misreads happen, especially on blurry or cropped images.</p>
                <Button variant="primary" onClick={save} loading={saving} disabled={!chosen.length}>Save {chosen.length} price{chosen.length === 1 ? '' : 's'}</Button>
              </div>
              {saved !== null && (
                <p className="mt-3 flex items-center gap-2 text-sm text-profit"><CheckCircle2 className="h-4 w-4" /> Saved {saved}. See them in the <Link to="/gallery" className="underline">Card Gallery</Link> or let the <Link to="/scanner" className="underline">Deal Finder</Link> rank them.</p>
              )}
            </>
          )}
        </Card>
      </div>
    </>
  )
}
