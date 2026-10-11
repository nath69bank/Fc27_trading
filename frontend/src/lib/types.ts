export type Signal = 'BUY' | 'HOLD' | 'SELL' | 'WATCH' | 'RISK'
export type Source = 'manual' | 'csv' | 'sample' | 'simulated' | 'live'
export type TransferStatus = 'active' | 'target_reached' | 'listed' | 'sold' | 'cancelled'

export interface CardInfo {
  id: string
  card_key: string
  player_name: string
  version: string | null
  rating: number | null
  position: string | null
  image_url: string | null
  futbin_url: string | null
  futgg_url: string | null
  is_demo: boolean
}

export type SeenOn = 'ingame' | 'futbin' | 'futgg' | 'other'

export interface Opportunity {
  player_name: string
  signal: Signal
  current_price: number | null
  historical_low: number | null
  historical_high: number | null
  entry_threshold_price: number | null
  suggested_max_buy: number | null
  expected_sell_price: number | null
  expected_net_proceeds: number | null
  estimated_profit: number | null
  roi_pct: number | null
  volatility_bp: number | null
  data_source: Source | null
  observed_at: string | null
  data_age_hours: number | null
  is_stale: boolean
  checks: Record<string, boolean | null>
  reasons: string[]
  explanation: string
  disclaimer: string
  break_even_sell: number | null
  trend_24h_pct: number | null
  card: CardInfo | null
  watchlist_id: string | null
  target_buy: number | null
  target_sell: number | null
  is_simulated: boolean | null
}

export interface WatchItem {
  id: string
  card: CardInfo
  target_buy: number
  target_sell: number
  favourite: boolean
  notes: string
  is_demo: boolean
  latest_price: number | null
  latest_source: Source | null
  latest_seen_on: SeenOn | null
  last_price_update: string | null
  is_stale: boolean
  historical_low: number | null
  historical_high: number | null
  net_at_target_sell: number
  estimated_profit: number
  estimated_roi_pct: number
  profit_at_current_price: number | null
  alert_status: 'no_data' | 'stale' | 'at_target_sell' | 'below_target_buy' | 'none'
  signal: Signal
  signal_explanation: string
  created_at: string
  updated_at: string
}

export interface PricePoint {
  id: string
  card_id: string
  platform: string
  price: number
  source: Source
  seen_on: SeenOn | null
  observed_at: string
}

export interface PriceStats {
  latest_price: number | null
  latest_source: Source | null
  latest_seen_on: SeenOn | null
  latest_at: string | null
  historical_low: number | null
  historical_high: number | null
  points: number
  is_stale: boolean
  age_hours: number | null
  trend_24h_pct: number | null
  is_simulated: boolean | null
}

export interface WatchDetail extends WatchItem {
  opportunity: Opportunity
  price_stats: PriceStats
  price_history: PricePoint[]
}

export interface LedgerEntry {
  id: string
  transfer_id: string
  player_name: string
  mode: 'simulation' | 'manual'
  quantity: number
  purchase_price: number
  purchase_cost: number
  sale_price: number
  gross_proceeds: number
  tax: number
  tax_rate_pct: number
  net_proceeds: number
  realised_profit: number
  roi_pct: number
  purchased_at: string
  sold_at: string
  holding_hours: number
  status: string
  notes: string
}

export interface Transfer {
  id: string
  card: CardInfo
  player_name: string
  mode: 'simulation' | 'manual'
  status: TransferStatus
  purchase_price: number
  quantity_purchased: number
  quantity_remaining: number
  quantity_sold: number
  total_invested: number
  original_cost: number
  target_sell_price: number
  expected_net_proceeds: number
  expected_tax: number
  expected_profit: number
  expected_roi_pct: number
  break_even_sell: number
  current_price: number
  current_price_source: string
  current_value: number
  unrealised_profit: number
  progress_to_target_pct: number | null
  estimated_price: number | null
  purchased_at: string
  closed_at: string | null
  holding_hours: number
  notes: string
  realised_profit: number
  sales: LedgerEntry[]
}

export interface DataStatus {
  mode: 'live' | 'manual' | 'simulated' | 'none'
  trading_mode: 'simulation' | 'manual'
  platform: string
  last_updated: string | null
  last_source: Source | null
  age_hours: number | null
  is_stale: boolean
  stale_after_hours: number
  live_provider: string | null
  live_available: boolean
  observations_by_source: Record<string, number>
}

export interface Alert {
  id: string
  type: string
  severity: 'info' | 'success' | 'warning' | 'danger'
  title: string
  message: string
  reference_id: string | null
  created_at: string
  read: boolean
}

export interface SignalRow {
  id: string
  card_id: string | null
  player_name: string
  signal: Signal
  current_price: number | null
  estimated_profit: number | null
  roi_pct: number | null
  data_source: Source | null
  explanation: string | null
  created_at: string
}

export interface Report {
  total_trades: number
  profitable_trades: number
  losing_trades: number
  breakeven_trades: number
  win_rate_pct: number
  total_realised_profit: number
  total_realised_losses: number
  net_realised_profit: number
  total_cost_basis: number
  trading_roi_pct: number
  average_profit_per_trade: number
  average_roi_pct: number
  best_trade: { id: string; player_name: string; quantity: number; realised_profit: number; roi_pct: number; sold_at: string } | null
  worst_trade: Report['best_trade']
  average_holding_hours: number | null
  available_coins: number
  invested_coins: number
  active_cards_value: number
  unrealised_profit: number
  total_portfolio_value: number
  starting_coins: number
  has_simulated_trades: boolean
  charts: {
    cumulative_profit: { t: string; profit: number; cumulative: number; player_name: string }[]
    daily_profit: { period: string; profit: number }[]
    weekly_profit: { period: string; profit: number }[]
    profit_by_player: { player_name: string; profit: number; trades: number }[]
    roi_distribution: { bucket: string; count: number }[]
    wins_vs_losses: { outcome: string; count: number }[]
    portfolio_value: { t: string; value: number; kind: string }[]
  }
}

export interface Dashboard {
  user: { username: string; is_demo: boolean }
  balance: { available_coins: number; invested_coins: number; updated_at: string }
  metrics: {
    available_coins: number
    invested_coins: number
    portfolio_value: number
    total_account_value: number
    unrealised_profit: number
    total_realised_profit: number
    open_transfers: number
    trading_roi_pct: number
    completed_trades: number
  }
  data_status: DataStatus
  recent_signals: SignalRow[]
  opportunities: Opportunity[]
  approaching_target: Transfer[]
  recent_trades: LedgerEntry[]
  pnl_chart: Report['charts']['cumulative_profit']
  alerts: { items: Alert[]; unread: number }
  walkthrough: { watchlist: boolean; evaluated: boolean; purchased: boolean; sold: boolean }
}

export interface Settings {
  starting_coins: number
  tax_rate_pct: number
  min_profit: number
  min_roi_pct: number
  entry_threshold_pct: number
  max_investment_per_card: number
  max_portfolio_exposure: number
  exposure_warning_pct: number
  default_sell_strategy: 'target_price' | 'historical_high' | 'quick_flip'
  platform: 'cross' | 'playstation' | 'xbox' | 'pc'
  stale_after_hours: number
  refresh_minutes: number
  holding_limit_hours: number
  max_volatility_pct: number
  mode: 'simulation' | 'manual'
  alert_prefs: Record<string, boolean>
  updated_at: string
}

export interface BalanceEvent {
  id: string
  kind: string
  available_delta: number
  invested_delta: number
  available_after: number
  invested_after: number
  reference_id: string | null
  reason: string
  created_at: string
}

export interface MarketCard extends CardInfo {
  stats: PriceStats
}

export interface Flip {
  buy_price: number
  sell_price: number
  quantity: number
  cost: number
  gross: number
  tax: number
  net: number
  profit: number
  profit_per_card: number
  roi_pct: number
  break_even_sell: number
  required_rise_pct: number
  target_profit: number
  max_buy_for_target: number
  sell_for_target: number
}

export interface FodderRow {
  rating: number
  name: string
  card: CardInfo | null
  stats: PriceStats | null
  floor: number | null
  break_even_sell?: number
  required_rise_pct?: number
  sell_at_uplift?: number
  profit_per_card?: number
  roi_pct?: number
  budget_qty?: number
  budget_profit?: number
}

export interface FodderBoard {
  uplift_pct: number
  budget: number | null
  tax_rate_pct: number
  ratings: FodderRow[]
}
