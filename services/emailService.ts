import { getAccountFor, getTokenFor, getTokenForGoogle, getGoogleAccount, initializeMsal } from "./smailAuth";

// Types
export interface EmailPayload {
    to: string[];
    cc?: string[];
    subject: string;
    htmlBody: string;
    from?: string; // Optional — ignored, sender is determined by active session
    attachments?: {
        name: string;
        contentBytes: string; // Base64
        contentType: string;
    }[];
}

/**
 * Unified Email Sender — Interactive Auth Only
 *
 * Strategies (in order):
 *   1. Outlook via MSAL — uses delegated /me/sendMail endpoint
 *   2. Gmail via Google Identity Services — uses Gmail API
 */
export const sendEmail = async (
    payload: EmailPayload,
    _preferredSender?: string
): Promise<{ success: boolean; provider: string; message: string }> => {

    console.log('[EmailService] === SEND EMAIL START ===');

    // Ensure MSAL is initialized before checking accounts
    // Wrapped defensively to prevent MSAL redirect/auth issues from crashing the app
    try {
        await initializeMsal();
    } catch (msalError: any) {
        console.warn('[EmailService] MSAL initialization failed, skipping Outlook:', msalError?.message);
        // Fall through to Gmail strategy
    }

    // ─── STRATEGY 1: OUTLOOK (MSAL Interactive) ─────────────────────────
    const outlookAccount = getAccountFor('automation') || getAccountFor('my');
    if (outlookAccount) {
        const key = getAccountFor('automation') ? 'automation' : 'my' as const;
        try {
            console.log('[EmailService] Trying MSAL token for:', outlookAccount.username);
            const token = await getTokenFor(key, ['Mail.Send']);
            const graphSender = outlookAccount.username || 'Unknown';

            const graphAttachments = payload.attachments?.map(att => ({
                "@odata.type": "#microsoft.graph.fileAttachment",
                name: att.name,
                contentBytes: att.contentBytes,
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

            console.log('[EmailService] Outlook payload:', JSON.stringify(graphPayload, null, 2));

            // Use /me/sendMail — works with delegated (interactive) tokens
            const resp = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
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
                console.warn('[EmailService] Outlook send failed:', errText);
                // Fall through to Gmail
            }
        } catch (e: any) {
            console.warn('[EmailService] Outlook auth/send error:', e.message);
            // Fall through to Gmail
        }
    }

    // ─── STRATEGY 2: GMAIL (Google Identity Services) ───────────────────
    const googleAccount = getGoogleAccount();
    if (googleAccount) {
        try {
            console.log('[EmailService] Trying Google token for:', googleAccount.email);
            const token = await getTokenForGoogle();

            // Build RFC 2822 email
            const toHeader = payload.to.join(', ');
            const ccHeader = payload.cc?.filter(e => e && e.trim()).join(', ') || '';
            const boundary = `boundary_${Date.now()}`;

            let rawEmail = '';
            rawEmail += `To: ${toHeader}\r\n`;
            if (ccHeader) rawEmail += `Cc: ${ccHeader}\r\n`;
            rawEmail += `Subject: ${payload.subject}\r\n`;
            rawEmail += `MIME-Version: 1.0\r\n`;

            if (payload.attachments && payload.attachments.length > 0) {
                rawEmail += `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n`;
                rawEmail += `--${boundary}\r\n`;
                rawEmail += `Content-Type: text/html; charset="UTF-8"\r\n\r\n`;
                rawEmail += `${payload.htmlBody}\r\n`;

                for (const att of payload.attachments) {
                    rawEmail += `--${boundary}\r\n`;
                    rawEmail += `Content-Type: ${att.contentType}; name="${att.name}"\r\n`;
                    rawEmail += `Content-Disposition: attachment; filename="${att.name}"\r\n`;
                    rawEmail += `Content-Transfer-Encoding: base64\r\n\r\n`;
                    rawEmail += `${att.contentBytes}\r\n`;
                }
                rawEmail += `--${boundary}--\r\n`;
            } else {
                rawEmail += `Content-Type: text/html; charset="UTF-8"\r\n\r\n`;
                rawEmail += payload.htmlBody;
            }

            // Base64url encode
            const encodedEmail = btoa(unescape(encodeURIComponent(rawEmail)))
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/, '');

            const resp = await fetch('https://www.googleapis.com/gmail/v1/users/me/messages/send', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ raw: encodedEmail })
            });

            if (resp.ok) {
                return { success: true, provider: 'Gmail', message: `Sent via Gmail (${googleAccount.email})` };
            } else {
                const errText = await resp.text();
                return { success: false, provider: 'Gmail', message: `Gmail API Error: ${errText}` };
            }
        } catch (e: any) {
            return { success: false, provider: 'Gmail', message: `Gmail Exception: ${e.message}` };
        }
    }

    return { success: false, provider: 'None', message: 'No email account connected. Sign in via Settings → Email Integration.' };
};
