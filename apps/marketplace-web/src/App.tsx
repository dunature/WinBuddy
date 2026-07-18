import * as React from 'react'
import { BrowserRouter, Link, Route, Routes } from 'react-router'
import { ArrowLeft } from 'lucide-react'
import { CatalogPage } from './components/CatalogPage'
import { DetailPage } from './components/DetailPage'
import { MarketplaceLayout } from './components/MarketplaceLayout'

function RouteNotFound(): React.ReactElement {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-3xl flex-col items-center justify-center px-5 text-center">
      <div className="error-code">404</div>
      <h1 className="mt-4 font-display text-4xl font-semibold">页面不在这份档案里</h1>
      <Link to="/" className="primary-link mt-7">返回技能市场 <ArrowLeft size={16} /></Link>
    </div>
  )
}

export function App(): React.ReactElement {
  return (
    <BrowserRouter basename="/agent/marketplace">
      <Routes>
        <Route element={<MarketplaceLayout />}>
          <Route index element={<CatalogPage />} />
          <Route path="skills/:identifier" element={<DetailPage />} />
          <Route path="*" element={<RouteNotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
