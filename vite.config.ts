import path from 'path';
import { readFileSync } from 'fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Embed package.version + build timestamp in the bundle so the browser
// can self-report which build it's running. Useful when HTTP caching /
// service-worker caching serves a stale build and we need a fast check
// (`window.__APP_VERSION__` in the console).
const pkgVersion = (JSON.parse(
  readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'),
) as { version: string }).version;
const buildTimeIso = new Date().toISOString();

// Note: API keys (Gemini, ElevenLabs, ShipsGo) must NOT be exposed to the client
// bundle. All AI/external calls go through Supabase Edge Functions where secrets
// live server-side. Only VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are safe
// for the client (anon key is designed for public exposure + RLS-gated).
export default defineConfig(() => {
  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
      // Dev-only proxy so the browser can reach the XS-agentic control-plane
      // without CORS or network-isolation issues. The control-plane lives on
      // the Mac mini under launchd (label ai.xs-agentic.control-plane),
      // publicly reachable via the Tailscale Funnel below.
      //
      // Override with VITE_AGENTIC_PROXY_TARGET=http://localhost:7878 if you
      // happen to be running a local control-plane during development.
      proxy: {
        '/xs-agentic': {
          target: process.env.VITE_AGENTIC_PROXY_TARGET || 'https://maxs-mac-mini.tailb21dd3.ts.net',
          changeOrigin: true,
          secure: true,
          rewrite: (p: string) => p.replace(/^\/xs-agentic/, ''),
        },
      },
    },
    plugins: [react()],
    // Polyfill process.env to empty object so legacy code reading
    // process.env.API_KEY / GEMINI_API_KEY resolves to undefined (fails
    // cleanly) instead of throwing ReferenceError. Phase 1 removes these
    // reads entirely by routing Gemini through Supabase Edge Functions.
    //
    // Value must be a JSON-stringified literal (esbuild requires JSON or
    // an identifier — `({})` fails the JSON-literal check in vite 6).
    define: {
      'process.env': JSON.stringify({}),
      __APP_VERSION__: JSON.stringify(pkgVersion),
      __BUILD_TIME__: JSON.stringify(buildTimeIso),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    },
    build: {
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
          auth: path.resolve(__dirname, 'auth.html'),
        },
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom'],
            'vendor-supabase': ['@supabase/supabase-js'],
            'vendor-pdf': ['jspdf', 'jspdf-autotable'],
            'vendor-charts': ['recharts'],
            'vendor-xlsx': ['xlsx'],
          },
        },
      },
    }
  };
});
