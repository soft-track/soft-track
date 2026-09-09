import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

import { defineConfig, type Plugin } from 'vite'

const DEFAULT_APP_BASE_URL = 'http://localhost:5173'

/**
 * Substitute `%APP_BASE_URL%` in index.html.
 *
 * The Open Graph tags need absolute URLs -- a relative og:image is ignored by
 * every unfurler -- and the only place that knows where an instance is
 * actually reachable is APP_BASE_URL, which the digest emails already use for
 * exactly this reason.
 *
 * Vite's own `%VITE_FOO%` substitution would do the job, but leaves the raw
 * placeholder in the output when the variable is unset, which would ship a
 * broken og:url to anyone who ran `npm run build` without it. A default here
 * means the tags are always well-formed; wrong for a deployment that never
 * configured it, which is the same bargain the digest links make.
 */
function appBaseUrl(): Plugin {
  const base = (process.env.APP_BASE_URL || DEFAULT_APP_BASE_URL).replace(/\/+$/, '')
  return {
    name: 'softtrack:app-base-url',
    transformIndexHtml: (html) => html.replaceAll('%APP_BASE_URL%', base),
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), appBaseUrl()],
  resolve: {
    // `@/board/KanbanBoard` rather than `../../board/KanbanBoard`: an import
    // that does not encode its own depth survives the file being moved.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
  },
})
