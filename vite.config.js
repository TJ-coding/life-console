import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  // `npm run dev:server` runs the API on :8787; the dev server forwards /api to it
  server: { proxy: { '/api': 'http://localhost:8787' } },
})
