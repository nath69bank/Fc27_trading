import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Calculator } from 'lucide-react'
import { api } from '../lib/api'
import { coins, parseCoins, pct, pnlClass, signedCoins } from '../lib/format'
import type { Flip } from '../lib/types'
import { Card, CoinInput, Field, Notice, PageHeader, Skeleton, cx } from '../components/ui'

function useFlip(buy: number | null, sell: number | null, quantity = 1, target = 0) {
  const [flip, setFlip] = useState<Flip | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!buy || !sell || quantity < 1) {
      setFlip(null)
      return
    }
    const t = setTimeout(() => {
      api<Flip>('/tools/flip', { method: 'POST', json: { buy_price: buy, sell_price: sell, quantity, target_profit: target } })
        .then((f) => { setFlip(f); setError(null) })
        .catch((e) => setError(e.message))
    }, 250)
    return () => clearTimeout(t)
  }, [buy, sell, quantity, target])
  return { flip, error }
}

function FlipResult({ flip, compact }: { flip: Flip; compact?: boolean }) {
  const rows: [string, ReactNode, string?][] = [
    ['Cost', coins(flip.cost)],
    ['Sale (gross)', coins(flip.gross)],
    ['Tax', `−${coins(flip.tax)}`, 'text-loss'],
    ['Net proceeds', coins(flip.net)],
    ['Profit', <>{signedCoins(flip.profit)} <span className="text-xs">({pct(flip.roi_pct)})</span></>, cx('font-semibold', pnlClass(flip.profit))],
    ['Break-even resale', `${coins(flip.break_even_sell)} (+${flip.required_rise_pct.toFixed(2)}%)`],
  ]
  if (flip.target_profit > 0) {
    rows.push([`Sell price for +${coins(flip.target_profit)}`, coins(flip.sell_for_target)])
    rows.push([`Max buy for +${coins(flip.target_profit)} at ${coins(flip.sell_price)}`, coins(flip.max_buy_for_target), 'text-gold'])
  }
  return (
    <dl className={cx('grid gap-x-6 gap-y-1 text-sm', compact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2')}>
      {rows.map(([k, v, cls]) => (
        <div key={k} className="flex items-center justify-between gap-3 border-b border-line/50 py-1">
          <dt className="text-ink-muted">{k}</dt>
          <dd className={cx('num text-right', cls)}>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

/** A worked example whose numbers come from the server, using the visitor's tax setting. */
function Example({ buy, sell, quantity = 1, target = 0, caption }: { buy: number; sell: number; quantity?: number; target?: number; caption: string }) {
  const { flip, error } = useFlip(buy, sell, quantity, target)
  return (
    <figure className="mt-3 rounded-lg border border-line bg-panel-2 p-3">
      <figcaption className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-muted">{caption}</figcaption>
      {error ? <p className="text-sm text-loss">{error}</p> : flip ? <FlipResult flip={flip} compact /> : <Skeleton className="h-28" />}
    </figure>
  )
}

function Lesson({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <Card title={<span><span className="num mr-2 text-gold">{String(n).padStart(2, '0')}</span>{title}</span>}>
      <div className="space-y-2 text-sm leading-relaxed text-ink-muted [&_strong]:text-ink">{children}</div>
    </Card>
  )
}

export default function Playbook() {
  const [f, setF] = useState({ buy: '25200', sell: '32000', qty: '1', target: '1000' })
  const { flip, error } = useFlip(parseCoins(f.buy), parseCoins(f.sell), Math.max(1, Math.min(100, parseInt(f.qty, 10) || 1)), parseCoins(f.target) ?? 0)
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }))

  return (
    <>
      <PageHeader
        title="Trading Playbook"
        subtitle="Core Ultimate Team trading ideas, each with the after-tax maths worked out. Examples are adapted from real community trading-group calls; prices change fast, so treat them as illustrations."
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-4">
          <Lesson n={1} title="The tax is the first hurdle">
            <p>Every sale loses <strong>5%</strong> to the transfer market. A card has to rise about <strong>5.3%</strong> before you've even broken even, so <em>the price you sell at</em> is what matters, not the price you see listed.</p>
            <p>Before any buy, know your <strong>break-even resale</strong> and the <strong>sell price for the profit you want</strong>. The app shows break-even on every opportunity, buy and transfer.</p>
            <Example buy={25_200} sell={32_000} target={1_000} caption="Buy at 25,200, aim to sell at 32,000" />
          </Lesson>

          <Lesson n={2} title="Sniping: 'below market' isn't always profit">
            <p>A typical call: <em>"super easy to snipe under 7.7k"</em> on a card listed at 7,900–8,000. If you snipe it to <strong>use</strong>, that's a saving. If you snipe it to <strong>resell</strong>, the tax decides:</p>
            <Example buy={7_700} sell={8_000} target={500} caption="Snipe at 7,700, relist at 8,000" />
            <p>Reselling at 8,000 nets 7,600, so a 7,700 snipe <strong>loses coins</strong>. To clear 500 you'd need to snipe at the "max buy" shown above. Snipes for profit need discounts of well over 5%.</p>
          </Lesson>

          <Lesson n={3} title="SBC fodder: buy the floor before the demand">
            <p>A demanding SBC (or a pair of them, like two big player SBCs landing together) eats high-rated cards, and the cheapest card at each rating (the <strong>floor</strong>) rises. Traders post ladders like <em>85 2.2k · 86 4.3k · 87 6k · 88 9.2k · 89 17.5k</em> and buy before the release.</p>
            <ul className="list-disc space-y-1 pl-5">
              <li><strong>Buy early</strong>, before the SBC is live, when floors are quiet.</li>
              <li><strong>Sell into the spike</strong>, usually in the first hours, not at the end when supply from packs catches up.</li>
              <li><strong>Spread across ratings</strong> instead of all on one, and size it so a flop doesn't hurt.</li>
              <li><strong>Mind the maths:</strong> a 10% rise on an 88 is only a small profit after tax.</li>
            </ul>
            <Example buy={9_200} sell={10_120} quantity={3} target={1_000} caption="Three 88s at 9,200, sold after a 10% rise" />
            <p>Track floors and plan with your own budget on the <Link to="/fodder" className="text-info underline">Fodder Tracker</Link>.</p>
          </Lesson>

          <Lesson n={4} title="Supply shocks: when a card goes back into packs">
            <p><em>"Came back into packs and has more than halved"</em>: when EA puts a card back into packs, supply floods in and the price can collapse in hours. Two lessons:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li><strong>Don't catch a falling knife.</strong> Buying on day one of a drop often means buying before the bottom. The app warns you when a price is down 10%+ in 24 hours.</li>
              <li><strong>The opportunity comes after.</strong> Once it settles, the card is often cheap enough to snipe for your own team or to hold until it leaves packs again.</li>
            </ul>
          </Lesson>

          <Lesson n={5} title="Cheap spec near the price floor">
            <p>A call like <em>"very rogue shout, get like 5"</em> on an 81 at 750, when the card's price range starts at 700, has a small downside because EA won't let it list much lower. The catch is that tax takes a big share of small moves:</p>
            <Example buy={750} sell={850} quantity={5} caption="Five at 750, sold at 850" />
            <p>Low-risk, low-reward: useful for learning, but the profit is mostly in volume. Check where the minimum list price sits before calling something "low risk".</p>
          </Lesson>

          <Lesson n={6} title="Platform and freshness">
            <p>Calls are often tagged <strong>PC</strong> or <strong>Console</strong> because the markets differ. Set your platform in <Link to="/settings" className="text-info underline">Settings</Link> and record prices for that market. A price that's hours old can be wrong: the app flags stale data and won't give a BUY on it.</p>
          </Lesson>

          <Lesson n={7} title="Risk rules that keep you trading">
            <ul className="list-disc space-y-1 pl-5">
              <li>Set your <strong>target sell before you buy</strong>, and record every trade so the stats tell you what's really working.</li>
              <li>Keep a limit per card and on total exposure (Settings). Don't put your whole club into one call.</li>
              <li>Calls in groups are opinions. Check the numbers yourself and accept that some will lose.</li>
            </ul>
          </Lesson>
        </div>

        <div className="space-y-4 xl:sticky xl:top-20 xl:self-start">
          <Card title={<span className="inline-flex items-center gap-2"><Calculator className="h-4 w-4 text-gold" /> Flip calculator</span>} subtitle="Calculated on the server with your tax setting">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Buy price">{(id) => <CoinInput id={id} value={f.buy} onChange={set('buy')} />}</Field>
              <Field label="Sell price">{(id) => <CoinInput id={id} value={f.sell} onChange={set('sell')} />}</Field>
              <Field label="Quantity">{(id) => <input id={id} className="input num" type="number" min={1} max={100} value={f.qty} onChange={(e) => set('qty')(e.target.value)} />}</Field>
              <Field label="Profit you want / card">{(id) => <CoinInput id={id} value={f.target} onChange={set('target')} />}</Field>
            </div>
            <div className="mt-3">
              {error ? <p className="text-sm text-loss">{error}</p> : flip ? <FlipResult flip={flip} compact /> : <p className="text-sm text-ink-muted">Enter a buy and sell price.</p>}
            </div>
          </Card>
          <Notice>None of this is financial advice or a guarantee: FC prices move on pack content, SBCs and EA decisions nobody can see in advance.</Notice>
        </div>
      </div>
    </>
  )
}
