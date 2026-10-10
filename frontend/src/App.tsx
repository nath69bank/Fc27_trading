import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import { Spinner } from './components/ui'
import { useAuth } from './lib/auth'
import Alerts from './pages/Alerts'
import Dashboard from './pages/Dashboard'
import History from './pages/History'
import Login from './pages/Login'
import Performance from './pages/Performance'
import PlayerDetail from './pages/PlayerDetail'
import Prices from './pages/Prices'
import Scanner from './pages/Scanner'
import SettingsPage from './pages/Settings'
import Transfers from './pages/Transfers'
import Watchlist from './pages/Watchlist'

export default function App() {
  const { user, ready } = useAuth()
  if (!ready) return <Spinner label="Starting FC 27 Market Engine…" />
  if (!user) return <Login />
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="scanner" element={<Scanner />} />
        <Route path="watchlist" element={<Watchlist />} />
        <Route path="watchlist/:id" element={<PlayerDetail />} />
        <Route path="transfers" element={<Transfers />} />
        <Route path="history" element={<History />} />
        <Route path="performance" element={<Performance />} />
        <Route path="prices" element={<Prices />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="alerts" element={<Alerts />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
