import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle, FlaskConical, PencilLine, Radio, Database, FileSpreadsheet } from 'lucide-react'
import type { Signal, Source } from '../lib/types'
import { coins } from '../lib/format'

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ')
}

// ---------------------------------------------------------------- buttons

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'gold'
const variants: Record<Variant, string> = {
  primary: 'bg-profit text-base font-semibold hover:bg-[#3ee388] disabled:bg-profit/40',
  gold: 'bg-gold text-base font-semibold hover:bg-[#ffd36b] disabled:bg-gold/40',
  secondary: 'border border-line-strong bg-panel-2 text-ink hover:border-ink-faint hover:bg-panel-3',
  ghost: 'text-ink-muted hover:bg-panel-2 hover:text-ink',
  danger: 'border border-loss/40 bg-loss/10 text-loss hover:bg-loss/20',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-sm',
        variants[variant],
        className,
      )}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  )
}

// ---------------------------------------------------------------- layout primitives

export function Card({ title, actions, children, className, subtitle }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('card', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3">
          <div>
            {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-ink-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  )
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-ink-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Metric({ label, value, sub, tone = 'default', icon }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'default' | 'profit' | 'loss' | 'gold'; icon?: ReactNode }) {
  const toneCls = { default: 'text-ink', profit: 'text-profit', loss: 'text-loss', gold: 'text-gold' }[tone]
  return (
    <div className="card relative overflow-hidden p-4">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-line-strong to-transparent" />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">{label}</span>
        {icon && <span className="text-ink-faint">{icon}</span>}
      </div>
      <div className={cx('num mt-2 text-xl font-semibold sm:text-2xl', toneCls)}>{value}</div>
      {sub && <div className="mt-1 text-xs text-ink-muted">{sub}</div>}
    </div>
  )
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-ink-muted" role="status">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {label}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-md bg-panel-3', className)} />
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
      {icon && <div className="mb-1 text-ink-faint">{icon}</div>}
      <p className="text-sm font-medium text-ink">{title}</p>
      {children && <p className="max-w-md text-sm text-ink-muted">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function ErrorBox({ error, onRetry }: { error: { message: string } | null; onRetry?: () => void }) {
  if (!error) return null
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-loss/40 bg-loss/10 px-3 py-2 text-sm text-loss">
      <span className="flex items-center gap-2">
        <XCircle className="h-4 w-4 shrink-0" aria-hidden /> {error.message}
      </span>
      {onRetry && (
        <Button size="sm" variant="ghost" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  )
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'demo'; children: ReactNode }) {
  const cls = {
    info: 'border-info/30 bg-info/10 text-[#a9c9ff]',
    warn: 'border-warn/40 bg-warn/10 text-warn',
    demo: 'border-gold/30 bg-gold/10 text-gold',
  }[tone]
  const Icon = tone === 'warn' ? AlertTriangle : tone === 'demo' ? FlaskConical : Info
  return (
    <div className={cx('flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed', cls)}>
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  )
}

// ---------------------------------------------------------------- badges

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-semibold', className)}>{children}</span>
}

const signalStyles: Record<Signal, string> = {
  BUY: 'border-profit/40 bg-profit/15 text-profit',
  SELL: 'border-gold/40 bg-gold/15 text-gold',
  HOLD: 'border-line-strong bg-panel-3 text-ink-muted',
  WATCH: 'border-info/40 bg-info/10 text-info',
  RISK: 'border-loss/40 bg-loss/10 text-loss',
}
export function SignalBadge({ signal, large }: { signal: Signal; large?: boolean }) {
  return <Badge className={cx(signalStyles[signal], large && 'px-2.5 py-1 text-xs tracking-wider')}>{signal === 'BUY' && large ? 'BUY SIGNAL' : signal}</Badge>
}

const sourceMeta: Record<Source, { label: string; cls: string; icon: typeof Radio }> = {
  live: { label: 'Live', cls: 'border-profit/40 text-profit', icon: Radio },
  manual: { label: 'Manual', cls: 'border-info/40 text-info', icon: PencilLine },
  csv: { label: 'CSV import', cls: 'border-info/40 text-info', icon: FileSpreadsheet },
  sample: { label: 'Demo sample', cls: 'border-gold/40 text-gold', icon: FlaskConical },
  simulated: { label: 'Simulated', cls: 'border-gold/40 text-gold', icon: FlaskConical },
}
export function SourceBadge({ source }: { source: Source | string | null | undefined }) {
  if (!source || !(source in sourceMeta)) {
    if (source === 'estimate') return <Badge className="border-line-strong text-ink-muted"><PencilLine className="h-3 w-3" aria-hidden />Your estimate</Badge>
    if (source === 'cost') return <Badge className="border-line-strong text-ink-muted"><Database className="h-3 w-3" aria-hidden />At cost</Badge>
    return <Badge className="border-line-strong text-ink-faint">No data</Badge>
  }
  const m = sourceMeta[source as Source]
  const Icon = m.icon
  return (
    <Badge className={m.cls}>
      <Icon className="h-3 w-3" aria-hidden />
      {m.label}
    </Badge>
  )
}

export function ModeBadge({ mode }: { mode: 'simulation' | 'manual' }) {
  return mode === 'simulation' ? (
    <Badge className="border-gold/40 text-gold"><FlaskConical className="h-3 w-3" aria-hidden />Simulation</Badge>
  ) : (
    <Badge className="border-info/40 text-info"><PencilLine className="h-3 w-3" aria-hidden />Manual record</Badge>
  )
}

export function Coins({ value, className }: { value: number | null | undefined; className?: string }) {
  return <span className={cx('num', className)}>{coins(value)}</span>
}

// ---------------------------------------------------------------- forms

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string | null; children: (id: string) => ReactNode }) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      {children(id)}
      {error ? <p className="mt-1 text-xs text-loss">{error}</p> : hint ? <p className="mt-1 text-xs text-ink-faint">{hint}</p> : null}
    </div>
  )
}

export function CoinInput({ id, value, onChange, placeholder, required, autoFocus }: { id: string; value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean; autoFocus?: boolean }) {
  return (
    <input
      id={id}
      className="input num"
      inputMode="numeric"
      autoComplete="off"
      value={value}
      placeholder={placeholder}
      required={required}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value.replace(/[^\d,]/g, ''))}
    />
  )
}

// ---------------------------------------------------------------- modal

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Tab' && ref.current) {
        const els = ref.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
        if (!els.length) return
        const first = els[0], last = els[els.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    const t = setTimeout(() => {
      const target = ref.current?.querySelector<HTMLElement>('[autofocus], input, select, textarea, button')
      target?.focus()
    }, 0)
    return () => {
      document.removeEventListener('keydown', onKey)
      clearTimeout(t)
      prev?.focus?.()
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={cx('card max-h-[92vh] w-full overflow-y-auto rounded-b-none sm:rounded-xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-panel px-4 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-ink-muted hover:bg-panel-3 hover:text-ink" aria-label="Close dialog">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3">{footer}</div>}
      </div>
    </div>
  )
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', danger, onConfirm, onClose, busy }: { open: boolean; title: string; message: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onClose: () => void; busy?: boolean }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={busy}>{confirmLabel}</Button>
        </>
      }
    >
      <div className="text-sm text-ink-muted">{message}</div>
    </Modal>
  )
}

// ---------------------------------------------------------------- toasts

interface Toast { id: number; tone: 'success' | 'error' | 'info'; message: string }
const ToastCtx = createContext<(tone: Toast['tone'], message: string) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((tone: Toast['tone'], message: string) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, tone, message }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 7000 : 4000)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={cx('pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm shadow-xl backdrop-blur',
            t.tone === 'success' && 'border-profit/40 bg-[#0f2a1c]/95 text-profit',
            t.tone === 'error' && 'border-loss/40 bg-[#2a1214]/95 text-loss',
            t.tone === 'info' && 'border-info/40 bg-[#101c30]/95 text-info')}>
            {t.tone === 'success' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : t.tone === 'error' ? <XCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <Info className="mt-0.5 h-4 w-4 shrink-0" />}
            <span className="text-ink">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
export const useToast = () => useContext(ToastCtx)

// ---------------------------------------------------------------- table helpers

export function SortHeader<K extends string>({ label, k, sort, setSort, align }: { label: string; k: K; sort: { key: K; desc: boolean }; setSort: (s: { key: K; desc: boolean }) => void; align?: 'right' }) {
  const active = sort.key === k
  return (
    <th className={cx('th', align === 'right' && 'text-right')} aria-sort={active ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
      <button className={cx('inline-flex items-center gap-1 uppercase hover:text-ink', active && 'text-ink')} onClick={() => setSort({ key: k, desc: active ? !sort.desc : true })}>
        {label}
        <span aria-hidden className="text-[9px]">{active ? (sort.desc ? '▼' : '▲') : '↕'}</span>
      </button>
    </th>
  )
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (total <= pageSize) return null
  return (
    <nav className="flex items-center justify-between gap-2 pt-3 text-xs text-ink-muted" aria-label="Pagination">
      <span>
        {(page - 1) * pageSize + 1}–{Math.min(total, page * pageSize)} of {total}
      </span>
      <div className="flex gap-1">
        <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
        <Button size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </nav>
  )
}

export function PlayerChip({ name, version, rating, position, image }: { name: string; version?: string | null; rating?: number | null; position?: string | null; image?: string | null }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <div className="relative flex h-9 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-gold/40 bg-gradient-to-b from-gold/30 to-gold-dim/10 text-[11px] font-bold text-gold">
        {image ? <img src={image} alt="" className="h-full w-full object-cover" /> : rating ?? name.slice(0, 2).toUpperCase()}
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-ink">{name}</div>
        <div className="truncate text-[11px] text-ink-muted">{[rating && `${rating}`, position, version].filter(Boolean).join(' · ') || 'Card'}</div>
      </div>
    </div>
  )
}
