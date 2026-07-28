import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App'
import './global.css'

// The webview is an app surface: no native context menu, no rubber-band scroll,
// and no accidental navigation when something is dropped outside a drop target.
document.addEventListener('contextmenu', (e) => {
  const target = e.target as HTMLElement | null
  const editable =
    target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
  if (!editable) e.preventDefault()
})
document.addEventListener('dragover', (e) => e.preventDefault())
document.addEventListener('drop', (e) => e.preventDefault())

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
