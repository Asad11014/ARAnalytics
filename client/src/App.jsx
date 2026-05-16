import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { SessionProvider } from './context/SessionContext'
import Login    from './pages/Login'
import AppShell from './pages/AppShell'

export default function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/"    element={<Login />} />
          <Route path="/app/*" element={<AppShell />} />
          <Route path="*"    element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  )
}
