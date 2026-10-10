const nf = new Intl.NumberFormat('en-GB')

export const coins = (n: number | null | undefined) => (n == null ? '—' : nf.format(n))
export const signedCoins = (n: number | null | undefined) => (n == null ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${nf.format(Math.abs(n))}`)
export const pct = (n: number | null | undefined, digits = 2) =>
  n == null ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(digits)}%`
export const plainPct = (n: number | null | undefined, digits = 1) => (n == null ? '—' : `${n.toFixed(digits)}%`)
export const compact = (n: number) =>
  new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 }).format(n)

export const pnlClass = (n: number | null | undefined) =>
  n == null || n === 0 ? 'text-ink-muted' : n > 0 ? 'text-profit' : 'text-loss'

export function dateTime(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}
export function shortDate(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}
export function ago(iso: string | null | undefined) {
  if (!iso) return 'never'
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const h = Math.round(mins / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}
export function duration(hours: number | null | undefined) {
  if (hours == null) return '—'
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`
  if (hours < 48) return `${hours.toFixed(1)}h`
  return `${(hours / 24).toFixed(1)}d`
}
export const parseCoins = (s: string): number | null => {
  const cleaned = s.replace(/[,\s]/g, '')
  if (!/^\d+$/.test(cleaned)) return null
  return parseInt(cleaned, 10)
}
