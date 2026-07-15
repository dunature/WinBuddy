import { Navigate, Route, Routes } from 'react-router-dom'
import { SiteHeader } from './components/SiteHeader.tsx'
import { MarketplacePage } from './pages/MarketplacePage.tsx'
import { SkillDetailPage } from './pages/SkillDetailPage.tsx'
import { AdminPlaceholderPage } from './pages/AdminPlaceholderPage.tsx'

export function App(): React.ReactElement {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <SiteHeader />
      <main id="main-content">
        <Routes>
          <Route path="/" element={<MarketplacePage />} />
          <Route path="/skills/:slug" element={<SkillDetailPage />} />
          <Route path="/admin/*" element={<AdminPlaceholderPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}
