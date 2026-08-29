import react from '@vitejs/plugin-react'
import devCerts from 'office-addin-dev-certs'
import { defineConfig, type ProxyOptions } from 'vite'

const harnessTarget = process.env.DSH_OFFICE_HARNESS_URL ?? 'http://127.0.0.1:3080'
const harnessOrigin = new URL(harnessTarget).origin
const https = process.argv.includes('build') ? undefined : await devCerts.getHttpsServerOptions()

const apiProxy: ProxyOptions = {
  target: harnessTarget,
  changeOrigin: true,
  secure: false,
  ws: true,
  configure(proxy) {
    // The browser-facing add-in and DSH use different local origins. DSH's
    // HTTP CSRF guard expects the upstream origin represented by this trusted
    // reverse proxy. Mux/host downlinks apply the same-origin check during the
    // WebSocket upgrade, while the Excel provider independently allowlists the
    // browser Origin (https://localhost:3010), so rewrite only the downlinks.
    proxy.on('proxyReq', (request) => { request.setHeader('origin', harnessOrigin) })
    proxy.on('proxyReqWs', (request, incoming) => {
      if (incoming.url === '/api/events.mux' || incoming.url === '/api/events.host') {
        request.setHeader('origin', harnessOrigin)
      }
    })
  },
}

export default defineConfig({
  root: 'src',
  plugins: react(),
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: { input: 'src/taskpane.html' },
  },
  server: {
    host: 'localhost',
    port: 3010,
    strictPort: true,
    ...(https ? { https } : {}),
    proxy: {
      '/api': apiProxy,
    },
  },
  preview: {
    host: 'localhost',
    port: 3010,
    strictPort: true,
    ...(https ? { https } : {}),
    proxy: {
      '/api': apiProxy,
    },
  },
})
