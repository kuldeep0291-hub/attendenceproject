import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      output: {
        manualChunks: {
          'pdf-worker': ['pdfjs-dist'],
          'face-api':   ['@vladmandic/face-api'],
          'recharts':   ['recharts'],
          'markdown':   ['react-markdown', 'remark-gfm', 'remark-math', 'rehype-katex'],
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
})
