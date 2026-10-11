import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import { Button, ErrorBox, Spinner } from './components/ui'
import { useAuth } from './lib/auth'
import Alerts from './pages/Alerts'
import Dashboard from './pages/Dashboard'
import Fodder from './pages/Fodder'
import Gallery from './pages/Gallery'
import Playbook from './pages/Playbook'
import History from './pages/History'
import Performance from './pages/Performance'
import PlayerDetail from './pages/PlayerDetail'
import Prices from './pages/Prices'
import Scanner from './pages/Scanner'
import SettingsPage from './pages/Settings'
import Transfers from './pages/Transfers'
import Watchlist from './pages/Watchlist'

export default function App() {
  const { user, ready, error, retry } = useAuth()
  if (!user && error)
    return (
      <main className="mx-auto mt-24 max-w-md space-y-3 px-4 text-center">
        <h1 className="text-lg font-semibold">FC 27 Market Engine</h1>
        <ErrorBox error={error} />
        <Button variant="primary" onClick={retry}>Try again</Button>
      </main>
    )
  if (!ready || !user) return <Spinner label="Setting up your trading desk…" />
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="scanner" element={<Scanner />} />
        <Route path="watchlist" element={<Watchlist />} />
        <Route path="watchlist/:id" element={<PlayerDetail />} />
        <Route path="gallery" element={<Gallery />} />
        <Route path="fodder" element={<Fodder />} />
        <Route path="playbook" element={<Playbook />} />
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
