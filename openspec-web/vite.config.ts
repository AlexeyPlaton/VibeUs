import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const isWidgetBuild = process.env.BUILD_MODE === 'widget';
const devApiTarget = process.env.VITE_DEV_API_URL || 'http://127.0.0.1:8000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  ...(isWidgetBuild ? {
    build: {
      lib: {
        entry: 'src/widget.tsx',
        name: 'VibusWidget',
        fileName: 'vibus-widget',
        cssFileName: 'vibus-widget',
        formats: ['umd']
      },
      rollupOptions: {},
      outDir: 'dist-widget'
    },
    define: {
      'process.env.NODE_ENV': '"production"'
    }
  } : {
    build: {
      outDir: 'dist-landing'
    },
    // Account pages use same-origin /api URLs in production. Mirror that
    // contract in local Vite development instead of letting the SPA fallback
    // return index.html for API requests.
    server: {
      proxy: {
        '/api': {
          target: devApiTarget,
          changeOrigin: true,
        },
      },
    },
  })
})
