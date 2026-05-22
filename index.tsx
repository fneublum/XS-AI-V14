
import './styles/globals.css';
import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initializeMsal } from './services/smailAuth';
import { shouldMountV2 } from './v2/services/featureFlags';

// Surface the build's version + timestamp on window so anyone can run
// `__APP_VERSION__` (or `window.__APP_VERSION__`) in the console to
// confirm which bundle is loaded. `__APP_VERSION__` is substituted by
// Vite's `define` at build time — see vite.config.ts.
declare global {
  // eslint-disable-next-line no-var
  var __APP_VERSION__: string;
  // eslint-disable-next-line no-var
  var __BUILD_TIME__: string;
  interface Window {
    __APP_VERSION__?: string;
    __BUILD_TIME__?: string;
  }
}
try {
  if (typeof window !== 'undefined') {
    window.__APP_VERSION__ = __APP_VERSION__;
    window.__BUILD_TIME__ = __BUILD_TIME__;
    console.log(`%cXS-ERP v${__APP_VERSION__}`, 'color:#818cf8;font-weight:600', `· built ${__BUILD_TIME__}`);
  }
} catch { /* defines missing in some test envs */ }

// Phase 3A/B — v2 opt-in. Precedence (highest wins):
//   1. `?v2=1` URL param — always v2
//   2. `?v2=0` URL param — always v1
//   3. localStorage `xs_feature_flags['v2-default']=true`
//   4. Default: v1
// See v2/services/featureFlags.ts for the source of truth.
const AppV2 = lazy(() => import('./v2/AppV2'));
const useV2 = shouldMountV2();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

// Detect if we're in a popup callback and handle it before rendering anything
// This prevents the full app from loading in the small auth popup window.
const isPopupCallback = typeof window !== 'undefined' && 
    window.opener && 
    (window.location.hash.includes("code=") || window.location.hash.includes("error=") || window.location.hash.includes("state="));

if (isPopupCallback) {
    console.log("Auth Popup Detected: Handling redirect...");
    // Initialize MSAL to process the hash.
    initializeMsal().then(() => {
        console.log("Auth Popup Processed.");
        setTimeout(() => {
            try {
                if (window.opener && !window.opener.closed) {
                    window.opener.postMessage({ type: "MSAL_POPUP_HANDLED" }, window.location.origin);
                }
                window.close();
            } catch (e) {
                console.error("Could not close popup:", e);
                document.body.innerHTML = '<div style="padding: 20px; text-align: center;"><h2>Authentication Complete</h2><p>You can close this window.</p></div>';
            }
        }, 1000);
    })
    .catch(e => {
        console.error("Auth Popup Initialization Failed:", e);
        if (window.opener) {
            window.opener.postMessage({ type: "MSAL_POPUP_FAILED", error: e.message }, "*");
        }
        window.close(); // Close even on error to prevent stuck window
    });
} else {
    // Normal App Render
    const root = ReactDOM.createRoot(rootElement);
    root.render(
      useV2
        ? <Suspense fallback={null}><AppV2 /></Suspense>
        : <App />
    );
}
