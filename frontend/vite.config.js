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
        runtimeCaching: [
          {
            // AI 요약: 생성 후 7일 캐시 (오프라인에서도 읽기 가능)
            urlPattern: /\/documents\/[^/]+\/summary/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'summaries-v1',
              expiration: { maxEntries: 60, maxAgeSeconds: 7 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // 문서 목록: 네트워크 우선, 실패 시 캐시
            urlPattern: /\/documents\/$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'doc-list-v1',
              expiration: { maxEntries: 10, maxAgeSeconds: 24 * 60 * 60 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // 퀴즈 기록: 네트워크 우선, 실패 시 캐시 (오답노트 오프라인 열람)
            urlPattern: /\/quiz\/(history|wrong-answers|user-stats)/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'quiz-data-v1',
              expiration: { maxEntries: 100, maxAgeSeconds: 24 * 60 * 60 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // 노트 목록
            urlPattern: /\/notes\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'notes-v1',
              expiration: { maxEntries: 200, maxAgeSeconds: 24 * 60 * 60 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
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
