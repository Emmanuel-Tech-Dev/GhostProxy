import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { ConfigProvider, theme } from 'antd'
import useAuthStore from './store/authStore'
import { refresh } from './api/auth'
import AppLayout from './component/layout/AppLayout'
import Login from './pages/Login'
import Register from './pages/Register'
import Dashboard from './pages/Dashboard'
import Routes_ from './pages/Routes'
import Logs from './pages/Logs'
import Analytics from './pages/Analytics'
import Settings from './pages/Settings'

const darkTokens = {
  colorPrimary: '#E94560',
  colorBgBase: '#0F0F1A',
  colorBgContainer: '#16162A',
  colorBgElevated: '#1E1E35',
  colorBorder: '#2A2A45',
  colorText: '#E2E2F0',
  colorTextSecondary: '#8888AA',
  fontFamily: 'Inter, sans-serif',
  borderRadius: 6,
  fontSize: 13,
}

const lightTokens = {
  colorPrimary: '#E94560',
  colorBgBase: '#F5F5F5',
  colorBgContainer: '#FFFFFF',
  colorBgElevated: '#FAFAFA',
  colorBorder: '#E8E8E8',
  colorText: '#1A1A2E',
  colorTextSecondary: '#666688',
  fontFamily: 'Inter, sans-serif',
  borderRadius: 6,
  fontSize: 13,
}

const sharedComponents = {
  Table: {
    headerBg: undefined,
  },
}

function getAntdTheme(mode) {
  return {
    algorithm: mode === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: mode === 'dark' ? darkTokens : lightTokens,
    components: sharedComponents,
  }
}

function AuthGuard({ children }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return children
}

function GuestGuard({ children }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  if (isAuthenticated) return <Navigate to="/dashboard" replace />
  return children
}

export default function App() {
  const [checking, setChecking] = useState(true)
  const setAuth = useAuthStore((s) => s.setAuth)
  const mode = useAuthStore((s) => s.theme)

  useEffect(() => {
    refresh()
      .then(({ data }) => setAuth(data.data.access_token, data.data.user))
      .catch(() => { })
      .finally(() => setChecking(false))
  }, [])

  if (checking) return null

  return (
    <ConfigProvider theme={getAntdTheme(mode)}>
      <div className={mode === 'dark' ? 'dark' : ''}>
        <Routes>
          <Route path="/login" element={
            <GuestGuard><Login /></GuestGuard>
          } />
          <Route path="/register" element={
            <GuestGuard><Register /></GuestGuard>
          } />
          <Route path="/" element={
            <AuthGuard><AppLayout /></AuthGuard>
          }>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="routes" element={<Routes_ />} />
            <Route path="logs" element={<Logs />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="settings" element={<Settings />} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </div>
    </ConfigProvider>
  )
}