import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Standalone web build (Phase 0 of the all-A roadmap) — same renderer source
// tree as electron.vite.config.ts's `renderer` block, but with no main/preload
// targets and a different HTML entry (index.web.html / main.web.tsx) so the
// existing Electron build stays completely untouched.
export default defineConfig({
  root: resolve('src/renderer'),
  resolve: {
    alias: {
      '@': resolve('src/renderer/src'),
    },
  },
  plugins: [react()],
  optimizeDeps: {
    // Unlike electron.vite.config.ts, @xterm/* is NOT excluded here: those
    // packages are pure UMD/CJS with no ESM build. electron-vite's preload
    // process (which has real Node module resolution) can load them however
    // it likes, but a plain browser needs Vite's optimizeDeps pre-bundling
    // step to synthesize ESM named exports from the UMD wrapper — excluding
    // them serves the raw UMD file with zero `export` statements, so
    // `import('@xterm/xterm')` resolves an empty module and `Terminal` is
    // undefined ("XTerm is not a constructor").
    include: ['monaco-editor/esm/vs/editor/editor.worker', '@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-web-links'],
  },
  worker: {
    format: 'es',
  },
  build: {
    outDir: resolve('out-web'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve('src/renderer/index.web.html'),
    },
  },
  server: {
    port: 5183,
  },
})
