import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  // `npm run dev:server` runs the API on :8787; the dev server forwards /api (and the trusted page) to it
  server: { proxy: { '/api': 'http://localhost:8787', '/trust': 'http://localhost:8787' } },
  // two pages: the app, and the workshop's sandboxed plugin preview (src/preview/main.js)
  build: { rollupOptions: { input: { main: 'index.html', preview: 'preview.html' } } },
})
