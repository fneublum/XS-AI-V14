
import './styles/globals.css';
import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initializeMsal } from './services/smailAuth';
import { shouldMountV2 } from './v2/services/featureFlags';

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
