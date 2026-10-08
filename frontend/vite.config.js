import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/StudyRAG/',
  plugins: [
    tailwindcss(),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'StudyRAG',
        short_name: 'StudyRAG',
        description: '강의자료 AI 학습 도우미',
        theme_color: '#1b6b50',
        background_color: '#faf9f7',
        display: 'standalone',
        start_url: '/StudyRAG/',
        icons: [
          { src: '/StudyRAG/icons.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,svg,woff2}'],
        navigateFallback: '/StudyRAG/index.html',
      },
    }),
  ],
  resolve: {
    alias: { '@': `${import.meta.dirname}/src` },
  },
  optimizeDeps: {
    include: ['@hugeicons/core-free-icons', '@hugeicons/react'],
  },
  server: {
    proxy: {
      '/documents': 'http://localhost:8000',
      '/qa': 'http://localhost:8000',
      '/quiz': 'http://localhost:8000',
      '/tutor': 'http://localhost:8000',
      '/rooms': 'http://localhost:8000',
      '/notes': 'http://localhost:8000',
    },
  },
})
