
import { PublicClientApplication, AccountInfo, LogLevel, InteractionRequiredAuthError } from "@azure/msal-browser";

// ─── MICROSOFT (OUTLOOK) via MSAL ──────────────────────────────────────────
const CLIENT_ID = "d7d38e4c-574a-4700-ada3-879725830da1";

export const msalConfig = {
    auth: {
        clientId: CLIENT_ID,
        authority: "https://login.microsoftonline.com/common",
        redirectUri: `${window.location.origin}`,
    },
    cache: {
        cacheLocation: "localStorage",
    },
    system: {
        loggerOptions: {
            loggerCallback: (level: LogLevel, message: string, containsPii: boolean) => {
                if (containsPii) return;
            },
        },
    },
};

export const msalInstance = new PublicClientApplication(msalConfig);

let msalInitialized = false;
let initPromise: Promise<void> | null = null;

export async function initializeMsal() {
    if (msalInitialized) return;
    if (initPromise) return initPromise;

    initPromise = msalInstance.initialize().then(async () => {
        msalInitialized = true;
        try {
            const response = await msalInstance.handleRedirectPromise();
            if (response && response.account) {
                const pendingKey = localStorage.getItem("smail_pending_key") as ProcessorKey | null;
                if (pendingKey) {
                    saveAccountFor(pendingKey, response.account);
                    msalInstance.setActiveAccount(response.account);
                    localStorage.removeItem("smail_pending_key");
                }
            }
        } catch (e) {
            console.error("MSAL Redirect Error:", e);
        }
    }).catch(e => {
        console.debug("MSAL initialization notice:", e);
        initPromise = null;
    });

    return initPromise;
}

export type ProcessorKey = "automation" | "my";
const accountKey = (k: ProcessorKey) => `smail.account.${k}`;

function saveAccountFor(k: ProcessorKey, account: AccountInfo) {
    localStorage.setItem(accountKey(k), account.homeAccountId);
}

function clearAccountFor(k: ProcessorKey) {
    localStorage.removeItem(accountKey(k));
}

export function getAccountFor(k: ProcessorKey): AccountInfo | null {
    const homeAccountId = localStorage.getItem(accountKey(k));
    if (!homeAccountId) return null;

    const accounts = msalInstance.getAllAccounts();
    return accounts.find(a => a.homeAccountId === homeAccountId) ?? null;
}

export async function loginFor(k: ProcessorKey, scopes: string[]): Promise<AccountInfo> {
    await initializeMsal();
    localStorage.setItem("smail_pending_key", k);

    try {
        await msalInstance.loginRedirect({
            scopes,
            prompt: "select_account"
        });
        throw new Error("Redirecting");
    } catch (e: any) {
        throw e;
    }
}

export async function logoutFor(k: ProcessorKey): Promise<void> {
    await initializeMsal();
    clearAccountFor(k);
}

export async function getTokenFor(k: ProcessorKey, scopes: string[]): Promise<string> {
    await initializeMsal();
    const account = getAccountFor(k);
    if (!account) throw new Error(`No account selected for ${k}. Please sign in.`);

    try {
        const result = await msalInstance.acquireTokenSilent({ account, scopes });
        return result.accessToken;
    } catch (e: any) {
        if (e instanceof InteractionRequiredAuthError || e.name === 'InteractionRequiredAuthError' ||
            e.errorCode === "interaction_required" || e.errorCode === "consent_required" || e.errorCode === "invalid_grant") {
            const result = await msalInstance.acquireTokenPopup({ scopes, account, prompt: "consent" });
            return result.accessToken;
        }
        throw e;
    }
}

export const loginRequest = {
    scopes: ["User.Read", "Mail.ReadWrite", "Mail.Send"]
};


// ─── GOOGLE (GMAIL) via Google Identity Services ────────────────────────────

// Replace with your Google Cloud OAuth 2.0 Web Client ID
const GOOGLE_CLIENT_ID = "1001697312282-rt6pdh198d3dm9aimitf4vsmsn4m67id.apps.googleusercontent.com";

const GOOGLE_SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/userinfo.email"
].join(" ");

const LS_GOOGLE_TOKEN = "smail.google.access_token";
const LS_GOOGLE_EMAIL = "smail.google.email";
const LS_GOOGLE_EXPIRY = "smail.google.expiry";

/** Load the Google Identity Services script dynamically */
function loadGisScript(): Promise<void> {
    return new Promise((resolve, reject) => {
        if ((window as any).google?.accounts?.oauth2) {
            resolve();
            return;
        }
        const script = document.createElement("script");
        script.src = "https://accounts.google.com/gsi/client";
        script.async = true;
        script.defer = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Failed to load Google Identity Services script"));
        document.head.appendChild(script);
    });
}

/** Interactive Google sign-in using OAuth2 popup */
export async function loginForGoogle(): Promise<{ email: string; token: string }> {
    await loadGisScript();

    return new Promise((resolve, reject) => {
        const client = (window as any).google.accounts.oauth2.initTokenClient({
            client_id: GOOGLE_CLIENT_ID,
            scope: GOOGLE_SCOPES,
            callback: async (response: any) => {
                if (response.error) {
                    reject(new Error(response.error_description || response.error));
                    return;
                }

                const token = response.access_token;
                const expiresIn = response.expires_in || 3600;
                const expiry = Date.now() + expiresIn * 1000;

                // Fetch user email
                try {
                    const profileResp = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
                        headers: { Authorization: `Bearer ${token}` }
                    });
                    const profile = await profileResp.json();
                    const email = profile.email || "Unknown";

                    // Persist
                    localStorage.setItem(LS_GOOGLE_TOKEN, token);
                    localStorage.setItem(LS_GOOGLE_EMAIL, email);
                    localStorage.setItem(LS_GOOGLE_EXPIRY, expiry.toString());

                    resolve({ email, token });
                } catch (e) {
                    reject(e);
                }
            },
        });

        client.requestAccessToken({ prompt: "consent" });
    });
}

/** Get the stored Google account info */
export function getGoogleAccount(): { email: string } | null {
    const email = localStorage.getItem(LS_GOOGLE_EMAIL);
    const expiry = localStorage.getItem(LS_GOOGLE_EXPIRY);

    if (!email) return null;

    // Check if expired
    if (expiry && Date.now() > parseInt(expiry)) {
        // Token expired, but we still know the account
        return { email };
    }

    return { email };
}

/** Get a valid Google access token (prompts re-auth if expired) */
export async function getTokenForGoogle(): Promise<string> {
    const token = localStorage.getItem(LS_GOOGLE_TOKEN);
    const expiry = localStorage.getItem(LS_GOOGLE_EXPIRY);

    if (token && expiry && Date.now() < parseInt(expiry)) {
        return token;
    }

    // Token expired or missing — re-authenticate
    const result = await loginForGoogle();
    return result.token;
}

/** Disconnect Google account */
export function logoutGoogle(): void {
    localStorage.removeItem(LS_GOOGLE_TOKEN);
    localStorage.removeItem(LS_GOOGLE_EMAIL);
    localStorage.removeItem(LS_GOOGLE_EXPIRY);
}
