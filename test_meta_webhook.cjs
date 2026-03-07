async function testWebhook() {
    const verifyToken = "xsolution_wh_2026";
    const challenge = "1158201444";

    const url = `https://qfskvevighylzzmyiwre.supabase.co/functions/v1/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=${verifyToken}&hub.challenge=${challenge}`;

    console.log("Simulating Meta's GET verification request to:");
    console.log(url);
    console.log("--------------------------------------------------");

    try {
        const res = await fetch(url);
        const text = await res.text();

        console.log(`Status Code: ${res.status} ${res.statusText}`);
        console.log(`Response Body: ${text}`);

        if (res.status === 200 && text === challenge) {
            console.log("\n✅ SUCCESS: The webhook successfully echoed the challenge exactly as Meta requires.");
        } else {
            console.log("\n❌ FAILED: The webhook did not return the expected challenge text or status 200.");
        }
    } catch (err) {
        console.error("Fetch Error:", err);
    }
}

testWebhook();
