import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [tailwindcss(), react()],
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
    },
  },
})
