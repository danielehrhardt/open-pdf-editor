import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const host = process.env.TAURI_DEV_HOST

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Tauri expects a fixed port and fails loudly rather than silently moving on.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: {
    target: ['es2020', 'chrome87', 'edge88', 'firefox78', 'safari14'],
    sourcemap: false,
    chunkSizeWarningLimit: 2500,
  },
  optimizeDeps: {
    exclude: ['@tauri-apps/api'],
  },
})
