import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/execute': {
        target: 'http://localhost:3004',
        changeOrigin: true,
      },
      '/result': {
        target: 'http://localhost:3004',
        changeOrigin: true,
      },
    },
  },
})
