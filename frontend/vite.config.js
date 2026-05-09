import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],

  // Tauri dev server needs a fixed port
  server: {
    port: 5173,
    strictPort: true,
    // Allow requests from Tauri webview
    cors: true,
  },

  // Tauri expects a relative base path in the built assets
  base: './',

  build: {
    // Tauri recommends keeping sourcemaps off for production
    sourcemap: false,
    // Use a relatively low target for better Tauri compatibility
    target: ['es2021', 'chrome105', 'safari13'],
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
})
