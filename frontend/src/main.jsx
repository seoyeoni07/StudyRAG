import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './tailwind.css'
import App from './App.jsx'
import { registerSW } from 'virtual:pwa-register'

// 새 버전이 배포되면 자동으로 바꿔 끼우고 페이지를 다시 불러온다 (registerType: autoUpdate).
// 오래 켜 둔 탭도 30분마다 새 버전이 있는지 확인한다.
registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (registration) setInterval(() => registration.update().catch(() => {}), 30 * 60 * 1000)
  },
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
