
import { ProcessorKey, getTokenFor } from "./smailAuth";

export async function getUserProfile(key: ProcessorKey) {
    const accessToken = await getTokenFor(key, ["User.Read"]);
    const headers = new Headers();
    const bearer = `Bearer ${accessToken}`;

    headers.append("Authorization", bearer);

    const options = {
        method: "GET",
        headers: headers
    };

    return fetch("https://graph.microsoft.com/v1.0/me", options)
        .then(response => response.json())
        .catch(error => console.error(error));
}

export async function getEmails(key: ProcessorKey, limit: number = 20, sortOrder: 'ASC' | 'DESC' = 'DESC', folderId: string = 'inbox') {
    const accessToken = await getTokenFor(key, ["Mail.Read"]);
    const headers = new Headers();
    const bearer = `Bearer ${accessToken}`;
    headers.append("Authorization", bearer);
    headers.append("Prefer", 'outlook.body-content-type="html"');

    const options = {
        method: "GET",
        headers: headers
    };

    const endpoint = `https://graph.microsoft.com/v1.0/me/mailFolders/${folderId}/messages?$select=sender,from,subject,receivedDateTime,bodyPreview,body,conversationId,toRecipients,isRead&$top=${limit}&$orderby=receivedDateTime ${sortOrder}`;

    return fetch(endpoint, options)
        .then(response => response.json())
        .catch(error => console.error(error));
}

export async function sendReply(key: ProcessorKey, messageId: string, replyContent: string) {
    const accessToken = await getTokenFor(key, ["Mail.Send"]);
    const headers = new Headers();
    const bearer = `Bearer ${accessToken}`;
    headers.append("Authorization", bearer);
    headers.append("Content-Type", "application/json");

    const body = {
        comment: replyContent
    };

    const options = {
        method: "POST",
        headers: headers,
        body: JSON.stringify(body)
    };

    return fetch(`https://graph.microsoft.com/v1.0/me/messages/${messageId}/reply`, options)
        .then(response => {
            if (response.ok) return true;
            throw new Error("Failed to send reply");
        })
        .catch(error => {
            console.error(error);
            throw error;
        });
}

export async function getConversationThread(key: ProcessorKey, conversationId: string, limit: number = 20) {
    const accessToken = await getTokenFor(key, ["Mail.Read"]);
    const headers = new Headers();
    headers.append("Authorization", `Bearer ${accessToken}`);
    headers.append("Prefer", 'outlook.body-content-type="html"');

    const filter = encodeURIComponent(`conversationId eq '${conversationId}'`);
    const endpoint = `https://graph.microsoft.com/v1.0/me/messages?$filter=${filter}&$select=sender,from,toRecipients,subject,receivedDateTime,sentDateTime,bodyPreview,body,conversationId&$top=${limit}`;

    return fetch(endpoint, { method: "GET", headers })
        .then(response => response.json())
        .catch(error => { console.error(error); return { value: [] }; });
}

export async function getSentEmails(key: ProcessorKey, limit: number = 30) {
    const accessToken = await getTokenFor(key, ["Mail.Read"]);
    const headers = new Headers();
    headers.append("Authorization", `Bearer ${accessToken}`);
    headers.append("Prefer", 'outlook.body-content-type="html"');

    const endpoint = `https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages?$select=sender,from,toRecipients,subject,sentDateTime,bodyPreview,body,conversationId&$top=${limit}&$orderby=sentDateTime DESC`;

    return fetch(endpoint, { method: "GET", headers })
        .then(response => response.json())
        .catch(error => { console.error(error); return { value: [] }; });
}

export async function getEmailAttachments(key: ProcessorKey, messageId: string) {
    const accessToken = await getTokenFor(key, ["Mail.Read"]);
    const headers = new Headers();
    headers.append("Authorization", `Bearer ${accessToken}`);

    const endpoint = `https://graph.microsoft.com/v1.0/me/messages/${messageId}/attachments`;

    return fetch(endpoint, { method: "GET", headers })
        .then(response => response.json())
        .catch(error => { console.error(error); return { value: [] }; });
}

export async function markEmailAsRead(key: ProcessorKey, messageId: string) {
    const accessToken = await getTokenFor(key, ["Mail.ReadWrite"]);
    const headers = new Headers();
    const bearer = `Bearer ${accessToken}`;
    headers.append("Authorization", bearer);
    headers.append("Content-Type", "application/json");

    const body = {
        isRead: true
    };

    const options = {
        method: "PATCH",
        headers: headers,
        body: JSON.stringify(body)
    };

    return fetch(`https://graph.microsoft.com/v1.0/me/messages/${messageId}`, options)
        .then(response => {
            if (response.ok) return true;
            throw new Error("Failed to mark email as read");
        })
        .catch(error => {
            console.error(error);
            throw error;
        });
}
