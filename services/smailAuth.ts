
import { PublicClientApplication, AccountInfo, AuthenticationResult, LogLevel } from "@azure/msal-browser";

// Credentials from requirements
// Note: Azure App Registration must be set to "Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant)"
const CLIENT_ID = "d7d38e4c-574a-4700-ada3-879725830da1";
const TENANT_ID = "5c1e7501-8d2d-49ba-9598-b6faa9249265";

export const msalConfig = {
    auth: {
        clientId: CLIENT_ID,
        authority: `https://login.microsoftonline.com/${TENANT_ID}`,
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
        // Handle redirect result
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

    // Store the key so we know who we are logging in for when we return
    localStorage.setItem("smail_pending_key", k);

    try {
        await msalInstance.loginRedirect({
            scopes,
            prompt: "select_account"
        });
        // The page will unload here, but we throw to stop execution if needed
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
        if (e.errorCode === "interaction_required" || e.errorCode === "consent_required") {
            const result = await msalInstance.acquireTokenPopup({ scopes, account });
            return result.accessToken;
        }
        throw e;
    }
}

export const loginRequest = {
    scopes: ["User.Read", "Mail.ReadWrite", "Mail.Send"]
};
