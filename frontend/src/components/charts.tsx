import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { ReactNode } from 'react'
import { coins, compact, shortDate, signedCoins } from '../lib/format'
import type { PricePoint } from '../lib/types'

// Chart roles. Green/red encode profit/loss polarity only (always alongside a signed value and
// a zero baseline); single-series magnitude charts use the neutral blue.
const C = {
  grid: '#1b2534',
  axis: '#5d6a7e',
  profit: '#2bd576',
  loss: '#ff5d5d',
  series: '#5b9dff',
  gold: '#f5c451',
  neutral: '#5d6a7e',
}
const axisProps = { stroke: C.axis, tick: { fill: C.axis, fontSize: 11 }, tickLine: false, axisLine: false } as const

function TooltipBox({ title, rows }: { title: ReactNode; rows: { label: string; value: ReactNode; color?: string }[] }) {
  return (
    <div className="rounded-lg border border-line-strong bg-panel/95 px-3 py-2 text-xs shadow-xl">
      <div className="mb-1 font-medium text-ink">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-ink-muted">
            {r.color && <span className="h-2 w-2 rounded-sm" style={{ background: r.color }} />}
            {r.label}
          </span>
          <span className="num text-ink">{r.value}</span>
        </div>
      ))}
    </div>
  )
}

export function ChartEmpty({ children, height = 220 }: { children: ReactNode; height?: number }) {
  return (
    <div className="flex items-center justify-center rounded-lg border border-dashed border-line text-center text-sm text-ink-faint" style={{ height }}>
      <div className="max-w-xs px-4">{children}</div>
    </div>
  )
}

/** Cumulative realised profit — one series, area above/below zero. */
export function CumulativeProfitChart({ data, height = 240 }: { data: { t: string; cumulative: number; profit: number; player_name: string }[]; height?: number }) {
  if (!data.length) return <ChartEmpty height={height}>No completed trades yet. Record a sale to start the profit curve.</ChartEmpty>
  const points = [{ t: data[0].t, cumulative: 0, profit: 0, player_name: 'Start' }, ...data]
  const last = data[data.length - 1].cumulative
  const color = last >= 0 ? C.profit : C.loss
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="cumFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.25} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="t" tickFormatter={shortDate} {...axisProps} minTickGap={24} />
        <YAxis tickFormatter={compact} {...axisProps} width={48} />
        <ReferenceLine y={0} stroke={C.axis} />
        <Tooltip
          cursor={{ stroke: C.axis, strokeDasharray: '3 3' }}
          content={({ active, payload }) =>
            active && payload?.length ? (
              <TooltipBox
                title={`${payload[0].payload.player_name} · ${shortDate(payload[0].payload.t)}`}
                rows={[
                  { label: 'Trade', value: signedCoins(payload[0].payload.profit) },
                  { label: 'Cumulative', value: signedCoins(payload[0].payload.cumulative), color },
                ]}
              />
            ) : null
          }
        />
        <Area type="monotone" dataKey="cumulative" stroke={color} strokeWidth={2} fill="url(#cumFill)" dot={false} activeDot={{ r: 4 }} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

/** Signed bars: profit above the baseline in green, losses below in red. */
export function SignedBarChart({ data, xKey, height = 220, xFormat, horizontal }: { data: Record<string, unknown>[]; xKey: string; height?: number; xFormat?: (v: string) => string; horizontal?: boolean }) {
  if (!data.length) return <ChartEmpty height={height}>Nothing to chart yet.</ChartEmpty>
  const tooltip = (
    <Tooltip
      cursor={{ fill: 'rgba(255,255,255,0.04)' }}
      content={({ active, payload }) =>
        active && payload?.length ? (
          <TooltipBox
            title={xFormat ? xFormat(String(payload[0].payload[xKey])) : String(payload[0].payload[xKey])}
            rows={[{ label: 'Realised profit', value: signedCoins(payload[0].payload.profit as number), color: (payload[0].payload.profit as number) >= 0 ? C.profit : C.loss }]}
          />
        ) : null
      }
    />
  )
  const cells = data.map((d, i) => <Cell key={i} fill={(d.profit as number) >= 0 ? C.profit : C.loss} />)
  if (horizontal) {
    return (
      <ResponsiveContainer width="100%" height={Math.max(height, data.length * 34 + 30)}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 4 }} barCategoryGap={6}>
          <CartesianGrid stroke={C.grid} horizontal={false} />
          <XAxis type="number" tickFormatter={compact} {...axisProps} />
          <YAxis type="category" dataKey={xKey} {...axisProps} width={130} tick={{ fill: '#8b98ab', fontSize: 11 }} />
          <ReferenceLine x={0} stroke={C.axis} />
          {tooltip}
          <Bar dataKey="profit" radius={[0, 4, 4, 0]} maxBarSize={22}>{cells}</Bar>
        </BarChart>
      </ResponsiveContainer>
    )
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} barCategoryGap="20%">
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey={xKey} tickFormatter={xFormat} {...axisProps} minTickGap={16} />
        <YAxis tickFormatter={compact} {...axisProps} width={48} />
        <ReferenceLine y={0} stroke={C.axis} />
        {tooltip}
        <Bar dataKey="profit" radius={[4, 4, 0, 0]} maxBarSize={36}>{cells}</Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Single-hue count bars (ROI distribution, outcome counts). */
export function CountBarChart({ data, xKey, height = 220, colors }: { data: Record<string, unknown>[]; xKey: string; height?: number; colors?: string[] }) {
  if (!data.some((d) => (d.count as number) > 0)) return <ChartEmpty height={height}>No completed trades yet.</ChartEmpty>
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 16, right: 12, bottom: 0, left: 0 }} barCategoryGap="18%">
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey={xKey} {...axisProps} interval={0} tick={{ fill: C.axis, fontSize: 10 }} />
        <YAxis allowDecimals={false} {...axisProps} width={32} />
        <Tooltip
          cursor={{ fill: 'rgba(255,255,255,0.04)' }}
          content={({ active, payload }) =>
            active && payload?.length ? <TooltipBox title={String(payload[0].payload[xKey])} rows={[{ label: 'Trades', value: String(payload[0].payload.count) }]} /> : null
          }
        />
        <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={44} label={{ position: 'top', fill: '#8b98ab', fontSize: 11 }}>
          {data.map((_, i) => <Cell key={i} fill={colors?.[i] ?? C.series} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export const OUTCOME_COLORS = [C.profit, C.loss, C.neutral]

/** Account value at cost over time (one series). */
export function ValueLineChart({ data, height = 220 }: { data: { t: string; value: number; kind: string }[]; height?: number }) {
  if (data.length < 2) return <ChartEmpty height={height}>Account value appears here once you trade or adjust your balance.</ChartEmpty>
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="t" tickFormatter={shortDate} {...axisProps} minTickGap={24} />
        <YAxis tickFormatter={compact} {...axisProps} width={52} domain={['auto', 'auto']} />
        <Tooltip
          cursor={{ stroke: C.axis, strokeDasharray: '3 3' }}
          content={({ active, payload }) =>
            active && payload?.length ? (
              <TooltipBox title={`${new Date(payload[0].payload.t).toLocaleString('en-GB')}`} rows={[{ label: 'Account value (at cost)', value: coins(payload[0].payload.value), color: C.series }, { label: 'Event', value: payload[0].payload.kind }]} />
            ) : null
          }
        />
        <Line type="stepAfter" dataKey="value" stroke={C.series} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
      </LineChart>
    </ResponsiveContainer>
  )
}

/** Price history with target buy / sell reference lines. */
export function PriceHistoryChart({ points, targetBuy, targetSell, height = 260 }: { points: PricePoint[]; targetBuy?: number | null; targetSell?: number | null; height?: number }) {
  if (!points.length) return <ChartEmpty height={height}>No price observations yet. Add a manual price, import a CSV or simulate a market move.</ChartEmpty>
  const data = [...points].sort((a, b) => a.observed_at.localeCompare(b.observed_at))
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 12, right: 64, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="observed_at" tickFormatter={shortDate} {...axisProps} minTickGap={28} />
        <YAxis tickFormatter={compact} {...axisProps} width={52} domain={['auto', 'auto']} />
        {targetBuy ? <ReferenceLine y={targetBuy} stroke={C.profit} strokeDasharray="5 4" label={{ value: `Buy ${compact(targetBuy)}`, position: 'right', fill: '#8b98ab', fontSize: 10 }} /> : null}
        {targetSell ? <ReferenceLine y={targetSell} stroke={C.gold} strokeDasharray="5 4" label={{ value: `Sell ${compact(targetSell)}`, position: 'right', fill: '#8b98ab', fontSize: 10 }} /> : null}
        <Tooltip
          cursor={{ stroke: C.axis, strokeDasharray: '3 3' }}
          content={({ active, payload }) =>
            active && payload?.length ? (
              <TooltipBox
                title={new Date(payload[0].payload.observed_at).toLocaleString('en-GB')}
                rows={[{ label: 'Price', value: coins(payload[0].payload.price), color: C.series }, { label: 'Source', value: payload[0].payload.source }]}
              />
            ) : null
          }
        />
        <Line type="linear" dataKey="price" stroke={C.series} strokeWidth={2} dot={data.length < 40 ? { r: 2.5, strokeWidth: 0, fill: C.series } : false} activeDot={{ r: 4 }} />
      </LineChart>
    </ResponsiveContainer>
  )
}
