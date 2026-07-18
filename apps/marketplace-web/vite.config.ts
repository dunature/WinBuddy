import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/agent/marketplace/',
  plugins: [react()],
  server: {
    port: 4319,
    proxy: {
      '/api': process.env.MARKETPLACE_API_PROXY_TARGET ?? 'http://127.0.0.1:4318',
    },
  },
})
