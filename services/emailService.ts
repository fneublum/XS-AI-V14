import { EmailClient } from "@azure/communication-email";
import { getAccountFor, getTokenFor } from "./smailAuth";

// Types
export interface EmailPayload {
    to: string[];
    cc?: string[];
    subject: string;
    htmlBody: string;
    from?: string; // Optional override
    attachments?: {
        name: string;
        contentBytes: string; // Base64
        contentType: string;
    }[];
}

// Configuration Helper
const DEFAULT_ACCOUNTS = [
    {
        id: 'sys_ec4_default',
        provider: 'OUTLOOK',
        email: 'ai.agent@ec4.enterprises',
        password: 'REDACTED_AZURE_SECRET', // Client Secret
        status: 'ACTIVE',
        lastChecked: new Date().toISOString(),
        // Outlook Config packed for internal usage or legacy support
        refreshToken: JSON.stringify({
            tenantId: 'b3035807-e440-4973-b739-b37f545ff4bd',
            clientId: 'f16a3e98-c150-420a-85f6-5ccfb9b8f0d5'
        }),
        tenantId: 'b3035807-e440-4973-b739-b37f545ff4bd',
        clientId: 'f16a3e98-c150-420a-85f6-5ccfb9b8f0d5',
        clientSecret: 'REDACTED_AZURE_SECRET'
    }
];

const getStoredAccounts = () => {
    try {
        const stored = localStorage.getItem('ai_email_accounts');
        const userAccounts = stored ? JSON.parse(stored) : [];

        // Return user accounts + defaults (if not overridden/duplicate by email)
        // We filter out defaults if the user has manually added the same email
        const activeDefaults = DEFAULT_ACCOUNTS.filter(d => !userAccounts.some((u: any) => u.email === d.email));

        return [...userAccounts, ...activeDefaults];
    } catch {
        return DEFAULT_ACCOUNTS;
    }
};

/**
 * Unified Email Sender
 * Priorities:
 * 1. Azure Communication Services (Reliable, Transactional)
 * 2. Outlook Service Principal (Background, Graph API)
 * 3. Outlook Interactive User (Foreground, Graph API)
 */
export const sendEmail = async (payload: EmailPayload, preferredSender: string = 'ai.agent@xsolution.com'): Promise<{ success: boolean; provider: string; message: string }> => {
    const accounts = getStoredAccounts();

    console.log('[EmailService] === SEND EMAIL START ===');
    console.log('[EmailService] Stored accounts:', accounts.map((a: any) => ({ email: a.email, provider: a.provider, status: a.status })));
    console.log('[EmailService] Preferred sender:', preferredSender);

    // ---------------------------------------------------------------------------
    // STRATEGY 1: AZURE COMMUNICATION SERVICES (High Reliability)
    // ---------------------------------------------------------------------------
    const acsAccount = accounts.find((a: any) => a.provider === 'AZURE_COMMUNICATION_SERVICES' && a.status === 'ACTIVE');

    if (acsAccount) {
        try {
            // Connection string is stored in 'password' field based on AdminCredentials logic (or we parsed it)
            // In AdminCredentials we stored connection string in 'password' and connection string also in 'password'
            // Let's verify how we stored it.  
            // The code I wrote put `finalAccessToken = acsConnectionString` into `password`.

            const connectionString = acsAccount.password;
            const senderAddress = acsAccount.email;

            const client = new EmailClient(connectionString);

            // Map attachments for ACS
            const acsAttachments = payload.attachments?.map(att => ({
                name: att.name,
                contentInBase64: att.contentBytes,
                contentType: att.contentType
            })) || [];

            const poller = await client.beginSend({
                senderAddress: senderAddress,
                content: {
                    subject: payload.subject,
                    html: payload.htmlBody,
                },
                recipients: {
                    to: payload.to.map(email => ({ address: email.trim() })),
                    cc: payload.cc?.filter(e => e && e.trim()).map(email => ({ address: email.trim() })) || [],
                },
                attachments: acsAttachments.length > 0 ? acsAttachments : undefined
            });

            // Wait for result (optional, but good for validation)
            const result = await poller.pollUntilDone();

            if (result.status === 'Succeeded') {
                return { success: true, provider: 'ACS', message: `Sent via Azure Communication Services (${senderAddress})` };
            } else {
                console.warn("ACS Send Failed status:", result);
                // Fallthrough to fallback
            }
        } catch (e: any) {
            console.error("ACS Send Exception:", e);
            // Fallthrough to fallback
        }
    }


    // ---------------------------------------------------------------------------
    // STRATEGY 2: OUTLOOK SERVICE PRINCIPAL (Background)
    // ---------------------------------------------------------------------------
    // Try to find specific Service Principal for preferredSender, or any active one
    let outlookAccount = accounts.find((a: any) => a.email.toLowerCase() === preferredSender.toLowerCase() && a.provider === 'OUTLOOK');
    if (!outlookAccount) {
        outlookAccount = accounts.find((a: any) => a.provider === 'OUTLOOK' && a.status === 'ACTIVE');
    }

    // ---------------------------------------------------------------------------
    // STRATEGY 3: OUTLOOK INTERACTIVE (Foreground / MSAL)
    // ---------------------------------------------------------------------------
    let interactiveKey: 'automation' | 'my' | null = null;
    let token = '';
    let graphSender = '';

    // If we have a Service Principal, try to get its token
    if (outlookAccount) {
        try {
            // Try to get tenantId and clientId from direct properties first, then from refreshToken
            let tenantId = outlookAccount.tenantId;
            let clientId = outlookAccount.clientId;

            // Fallback to parsing refreshToken if direct properties not available
            if (!tenantId || !clientId) {
                const config = JSON.parse(outlookAccount.refreshToken || '{}');
                tenantId = tenantId || config.tenantId;
                clientId = clientId || config.clientId;
            }

            if (!tenantId || !clientId) {
                console.warn('[EmailService] Outlook account missing tenantId or clientId');
            } else {
                // Try direct token request first (works for Service Principal with CORS support)
                const directTokenEndpoint = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
                const bodyParams = new URLSearchParams({
                    client_id: clientId,
                    scope: 'https://graph.microsoft.com/.default',
                    client_secret: outlookAccount.password || outlookAccount.clientSecret,
                    grant_type: 'client_credentials'
                });

                console.log('[EmailService] Attempting Service Principal token request...');

                try {
                    const resp = await fetch(directTokenEndpoint, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: bodyParams
                    });

                    if (resp.ok) {
                        const data = await resp.json();
                        token = data.access_token;
                        graphSender = outlookAccount.email;
                        console.log('[EmailService] Service Principal token acquired successfully');
                    } else {
                        const errText = await resp.text();
                        console.warn('[EmailService] Direct token request failed:', errText);

                        // Fallback: Try with CORS proxy for local development
                        if (!window.location.hostname.includes('appspot.com')) {
                            console.log('[EmailService] Trying CORS proxy fallback...');
                            const proxyEndpoint = `https://corsproxy.io/?` + encodeURIComponent(directTokenEndpoint);
                            const proxyResp = await fetch(proxyEndpoint, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                                body: bodyParams
                            });
                            if (proxyResp.ok) {
                                const data = await proxyResp.json();
                                token = data.access_token;
                                graphSender = outlookAccount.email;
                                console.log('[EmailService] CORS proxy token acquired successfully');
                            }
                        }
                    }
                } catch (fetchErr) {
                    console.error('[EmailService] Token fetch error:', fetchErr);
                }
            }
        } catch (e) {
            console.error("[EmailService] Service Principal Auth Failed", e);
        }
    }


    // If Service Principal failed or missing, try Interactive
    if (!token) {
        console.log('[EmailService] Trying MSAL Interactive Auth...');
        const autoAcc = getAccountFor('automation');
        const myAcc = getAccountFor('my');
        console.log('[EmailService] MSAL accounts - automation:', autoAcc?.username, 'my:', myAcc?.username);

        if (autoAcc || myAcc) {
            interactiveKey = autoAcc ? 'automation' : 'my';
            try {
                console.log('[EmailService] Getting token for:', interactiveKey);
                token = await getTokenFor(interactiveKey, ['Mail.Send']);
                graphSender = getAccountFor(interactiveKey)?.username || 'Unknown';
                console.log('[EmailService] Got MSAL token for:', graphSender);
            } catch (e) {
                console.error("[EmailService] Interactive Auth Failed", e);
            }
        } else {
            console.log('[EmailService] No MSAL accounts found. User needs to connect email in Settings.');
        }
    }

    // ---------------------------------------------------------------------------
    // EXECUTE GRAPH SEND
    // ---------------------------------------------------------------------------
    if (token && graphSender) {
        try {
            // Map attachments for Graph API
            // Needs: "@odata.type": "#microsoft.graph.fileAttachment", name, contentBytes, contentType
            const graphAttachments = payload.attachments?.map(att => ({
                "@odata.type": "#microsoft.graph.fileAttachment",
                name: att.name,
                contentBytes: att.contentBytes, // Graph API expects base64 string
                contentType: att.contentType
            })) || [];

            const graphPayload = {
                message: {
                    subject: payload.subject,
                    body: {
                        contentType: "HTML",
                        content: payload.htmlBody
                    },
                    toRecipients: payload.to.map(email => ({ emailAddress: { address: email.trim() } })),
                    ccRecipients: payload.cc?.filter(e => e && e.trim()).map(email => ({ emailAddress: { address: email.trim() } })) || [],
                    attachments: graphAttachments
                },
                saveToSentItems: true
            };

            const resp = await fetch(`https://graph.microsoft.com/v1.0/users/${graphSender}/sendMail`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(graphPayload)
            });

            if (resp.ok) {
                return { success: true, provider: 'Outlook', message: `Sent via Outlook (${graphSender})` };
            } else {
                const errText = await resp.text();
                return { success: false, provider: 'Outlook', message: `Outlook API Error: ${errText}` };
            }
        } catch (e: any) {
            return { success: false, provider: 'Outlook', message: `Outlook Exception: ${e.message}` };
        }
    }

    return { success: false, provider: 'None', message: 'No valid email configuration found (ACS or Outlook).' };
};
