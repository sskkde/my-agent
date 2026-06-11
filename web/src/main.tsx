import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'

type AppTheme = 'default' | 'warm-paper' | 'dark'

const THEME_STORAGE_KEY = 'agent-platform-theme'
const APP_THEMES = new Set<AppTheme>(['default', 'warm-paper', 'dark'])
const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)
const initialTheme = APP_THEMES.has(storedTheme as AppTheme) ? (storedTheme as AppTheme) : 'default'
document.documentElement.dataset.theme = initialTheme

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
