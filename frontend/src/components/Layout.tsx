import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  Bell, BookOpen, CandlestickChart, ClipboardList, Gauge, LayoutGrid, LineChart, Menu, RotateCcw, Radar, Settings as SettingsIcon, Star, X,
} from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { ago } from '../lib/format'
import type { DataStatus } from '../lib/types'
import { Badge, ConfirmDialog, cx } from './ui'

export const REFRESH_EVENT = 'fc27:refresh'
export const announceChange = () => window.dispatchEvent(new Event(REFRESH_EVENT))

export function useRefreshSignal(fn: () => void) {
  useEffect(() => {
    window.addEventListener(REFRESH_EVENT, fn)
    return () => window.removeEventListener(REFRESH_EVENT, fn)
  }, [fn])
}

const NAV = [
  { to: '/', label: 'Dashboard', icon: Gauge, end: true },
  { to: '/scanner', label: 'Market Scanner', icon: Radar },
  { to: '/watchlist', label: 'Watchlist', icon: Star },
  { to: '/gallery', label: 'Card Gallery', icon: LayoutGrid },
  { to: '/transfers', label: 'Active Transfers', icon: ClipboardList },
  { to: '/history', label: 'Trade History', icon: BookOpen },
  { to: '/performance', label: 'Performance Analytics', icon: LineChart },
  { to: '/prices', label: 'Price History', icon: CandlestickChart },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
]

export function DataModeIndicator({ status, compact }: { status: DataStatus | null; compact?: boolean }) {
  if (!status) return null
  const meta = {
    live: { label: 'LIVE', cls: 'border-profit/50 bg-profit/10 text-profit', dot: 'bg-profit' },
    manual: { label: 'MANUAL', cls: 'border-info/50 bg-info/10 text-info', dot: 'bg-info' },
    simulated: { label: 'SIMULATED', cls: 'border-gold/50 bg-gold/10 text-gold', dot: 'bg-gold' },
    none: { label: 'NO DATA', cls: 'border-line-strong bg-panel-2 text-ink-muted', dot: 'bg-ink-faint' },
  }[status.mode]
  return (
    <div className="flex items-center gap-2" title={`Market data: ${meta.label.toLowerCase()}. Trading mode: ${status.trading_mode}.`}>
      <Badge className={meta.cls}>
        <span className={cx('h-1.5 w-1.5 rounded-full', meta.dot, status.mode === 'live' && 'animate-pulse')} aria-hidden />
        {meta.label} DATA
      </Badge>
      {!compact && (
        <span className={cx('hidden text-xs md:inline', status.is_stale && status.mode !== 'none' ? 'text-warn' : 'text-ink-muted')}>
          {status.mode === 'none' ? 'Add prices to begin' : `Updated ${ago(status.last_updated)}${status.is_stale ? ' · stale' : ''}`}
        </span>
      )}
      <Badge className={status.trading_mode === 'simulation' ? 'border-gold/40 text-gold' : 'border-info/40 text-info'}>
        {status.trading_mode === 'simulation' ? 'Simulation mode' : 'Manual tracking'}
      </Badge>
    </div>
  )
}

export default function Layout() {
  const { startOver } = useAuth()
  const [confirmReset, setConfirmReset] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [status, setStatus] = useState<DataStatus | null>(null)
  const [unread, setUnread] = useState(0)
  const [open, setOpen] = useState(false)
  const [persistent, setPersistent] = useState(true)
  const location = useLocation()
  useEffect(() => {
    api<{ persistent: boolean }>('/health').then((h) => setPersistent(h.persistent)).catch(() => {})
  }, [])

  const load = () => {
    api<DataStatus>('/market/status').then(setStatus).catch(() => {})
    api<{ unread: number }>('/alerts?unread=true').then((r) => setUnread(r.unread)).catch(() => {})
  }
  useEffect(load, [location.pathname])
  useRefreshSignal(load)
  useEffect(() => {
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => setOpen(false), [location.pathname])

  const today = new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })

  const sidebar = (
    <nav aria-label="Main" className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-4 pb-5 pt-5">
        <img src="/favicon.svg" alt="" className="h-8 w-8" />
        <div>
          <div className="text-sm font-bold leading-tight tracking-tight">FC 27 Market Engine</div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">Trade Smarter. Track Every Coin.</div>
        </div>
      </div>
      <ul className="flex-1 space-y-0.5 px-2">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                cx('flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                  isActive ? 'bg-gradient-to-r from-profit/15 to-transparent font-medium text-ink shadow-[inset_2px_0_0_#2bd576]' : 'text-ink-muted hover:bg-panel-2 hover:text-ink')
              }
            >
              <Icon className="h-4 w-4" aria-hidden />
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
      <div className="m-3 rounded-lg border border-line bg-panel-2 p-3 text-[11px] leading-relaxed text-ink-faint">
        Not affiliated with EA SPORTS. No real transfers are executed — trades here are simulations or your own manual records.
      </div>
    </nav>
  )

  return (
    <div className="min-h-screen lg:pl-64">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-panel focus:px-3 focus:py-2">Skip to content</a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-line bg-panel/95 lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 border-r border-line bg-panel">
            <button className="absolute right-3 top-5 rounded p-1 text-ink-muted" onClick={() => setOpen(false)} aria-label="Close menu"><X className="h-5 w-5" /></button>
            {sidebar}
          </aside>
        </div>
      )}
      <header className="sticky top-0 z-20 border-b border-line bg-base/85 backdrop-blur">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:px-6">
          <button className="rounded-md p-1.5 text-ink-muted hover:bg-panel-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
          <span className="text-sm font-semibold lg:hidden">FC 27 Market Engine</span>
          <span className="hidden text-xs text-ink-muted sm:inline">{today}</span>
          <div className="order-last w-full sm:order-none sm:ml-auto sm:w-auto"><DataModeIndicator status={status} /></div>
          <div className="ml-auto flex items-center gap-1 sm:ml-0">
            <Badge className="border-gold/40 bg-gold/10 text-gold">DEMO DESK</Badge>
            <NavLink to="/alerts" className="relative rounded-lg p-2 text-ink-muted hover:bg-panel-2 hover:text-ink" aria-label={`Alerts, ${unread} unread`}>
              <Bell className="h-5 w-5" />
              {unread > 0 && <span className="num absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-loss px-1 text-center text-[10px] font-bold leading-[18px] text-white">{unread > 99 ? '99+' : unread}</span>}
            </NavLink>
            <button onClick={() => setConfirmReset(true)} className="rounded-lg p-2 text-ink-muted hover:bg-panel-2 hover:text-ink" aria-label="Start over with a fresh demo desk" title="Start over"><RotateCcw className="h-4 w-4" /></button>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6">
        {!persistent && (
          <div role="alert" className="mb-4 rounded-lg border border-loss/40 bg-loss/10 px-3 py-2 text-sm text-loss">
            <strong>Temporary storage.</strong> This deployment has no database configured, so accounts, trades and balances can be lost at any time. Connect PostgreSQL (DATABASE_URL) to keep data.
          </div>
        )}
        <Outlet />
      </main>
      <ConfirmDialog
        open={confirmReset}
        danger
        title="Start over?"
        confirmLabel="Start over"
        busy={resetting}
        onClose={() => setConfirmReset(false)}
        onConfirm={async () => {
          setResetting(true)
          await startOver()
          setResetting(false)
          setConfirmReset(false)
        }}
        message="This clears your watchlist, trades and coins in this browser and opens a fresh demo desk with 150,000 virtual coins. It cannot be undone."
      />
    </div>
  )
}
