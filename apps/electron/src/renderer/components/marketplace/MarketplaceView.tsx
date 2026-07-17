import * as React from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { MarketplaceCatalogPage } from './MarketplaceCatalogPage'
import { MarketplaceSkillDetailPage } from './MarketplaceSkillDetailPage'

export function MarketplaceView(): React.ReactElement {
  return (
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<MarketplaceCatalogPage />} />
        <Route path="/skills/:identifier" element={<MarketplaceSkillDetailPage />} />
      </Routes>
    </MemoryRouter>
  )
}
