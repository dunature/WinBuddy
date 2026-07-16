import { Navigate, Route, Routes } from 'react-router-dom'
import { SiteHeader } from './components/SiteHeader.tsx'
import { MarketplacePage } from './pages/MarketplacePage.tsx'
import { SkillDetailPage } from './pages/SkillDetailPage.tsx'
import { AdminLoginPage } from './pages/AdminLoginPage.tsx'
import { AdminHomePage } from './pages/AdminHomePage.tsx'
import { AdminProtectedRoute } from './components/AdminProtectedRoute.tsx'
import { AdminLayout } from './components/AdminLayout.tsx'
import { AdminUploadPage } from './pages/AdminUploadPage.tsx'
import { AdminReviewPage } from './pages/AdminReviewPage.tsx'
import { AdminSkillsPage } from './pages/AdminSkillsPage.tsx'

export function App(): React.ReactElement {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <Routes>
        <Route path="/" element={<><SiteHeader /><main id="main-content"><MarketplacePage /></main></>} />
        <Route path="/skills/:slug" element={<><SiteHeader /><main id="main-content"><SkillDetailPage /></main></>} />
        <Route path="/admin/login" element={<AdminLoginPage />} />
        <Route element={<AdminProtectedRoute />}><Route element={<AdminLayout />}><Route path="/admin" element={<AdminHomePage />} /><Route path="/admin/skills" element={<AdminSkillsPage />} /><Route path="/admin/uploads" element={<AdminUploadPage />} /><Route path="/admin/reviews" element={<AdminReviewPage />} /></Route></Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}
