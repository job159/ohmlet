import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { onLangChange, t } from './i18n'
import './ui/styles.css'

// window title follows the UI language (index.html ships the zh-TW one)
const applyTitle = () => {
  document.title = t('ohmlet — 3D breadboard simulator')
}
applyTitle()
onLangChange(applyTitle)
if (new URLSearchParams(window.location.search).has('e2e')) void import('./dev/e2e-hooks') // read-only test hooks (scripts/acceptance-e2e.mjs)

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
