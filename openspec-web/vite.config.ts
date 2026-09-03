import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const isWidgetBuild = process.env.BUILD_MODE === 'widget';

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
    }
  })
})
