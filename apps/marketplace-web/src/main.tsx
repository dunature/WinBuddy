import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'jotai'
import { App } from './App'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('缺少应用挂载节点')
createRoot(root).render(
  <React.StrictMode>
    <Provider><App /></Provider>
  </React.StrictMode>,
)
