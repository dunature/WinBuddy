import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App.tsx'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('无法挂载 Marketplace 页面')

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
