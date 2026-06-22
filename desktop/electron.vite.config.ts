import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['electron'],
        output: { format: 'cjs' }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['electron'],
        output: { format: 'cjs' }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src')
      }
    },
    plugins: [react()],
    optimizeDeps: {
      exclude: ['@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-web-links'],
      include: ['monaco-editor/esm/vs/editor/editor.worker']
    },
    worker: {
      format: 'es'
    }
  }
})
