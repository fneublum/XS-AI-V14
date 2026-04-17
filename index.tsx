
import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initializeMsal } from './services/smailAuth';

// Phase 3A — opt-in v2 shell. `?v2=1` in the URL mounts v2/AppV2 instead
// of the legacy App. v2 bundle only loads when the flag is set.
const AppV2 = lazy(() => import('./v2/AppV2'));
const useV2 = typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).get('v2') === '1';

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
