// Verify Twilio webhook signatures (HMAC-SHA1 of URL + sorted POST params).
// Reference: https://www.twilio.com/docs/usage/webhooks/webhooks-security

/**
 * Verify the X-Twilio-Signature header against the request URL + form params.
 * Returns true if valid, false otherwise.
 *
 * If TWILIO_AUTH_TOKEN is not set, returns false (fail-closed).
 */
export async function verifyTwilioSignature(
  url: string,
  formData: FormData,
  signatureHeader: string | null,
): Promise<boolean> {
  const authToken = Deno.env.get('TWILIO_AUTH_TOKEN');
  if (!authToken) {
    console.error('[twilio-signature] TWILIO_AUTH_TOKEN not configured — rejecting');
    return false;
  }
  if (!signatureHeader) return false;

  // Build the string to sign: URL + sorted(key + value) concatenation
  const params: [string, string][] = [];
  for (const [k, v] of formData.entries()) {
    params.push([k, typeof v === 'string' ? v : '']);
  }
  params.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  let toSign = url;
  for (const [k, v] of params) toSign += k + v;

  // HMAC-SHA1, base64-encoded
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(authToken),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(toSign),
  );
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));

  // Constant-time compare
  return timingSafeEqual(expected, signatureHeader);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
