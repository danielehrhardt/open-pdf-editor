import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App'
import { initPlatform } from './platform'
import './global.css'

// The webview is an app surface: no native context menu, and no navigating away
// because something was dropped outside a drop target.
document.addEventListener('contextmenu', (e) => {
  const target = e.target as HTMLElement | null
  const editable =
    target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
  if (!editable) e.preventDefault()
})

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root')

// Nothing renders until we know which host we are on — every file operation
// goes through the platform, and components read it synchronously. Kept as a
// promise chain rather than top-level await, which needs Safari 15.
void initPlatform().then((host) => {
  // Lets the stylesheet reserve room for the desktop window controls without
  // leaving a gap in the browser, which has none.
  document.documentElement.dataset.host = host.id

  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
