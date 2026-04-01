require("dotenv").config();

const { PublicClientApplication } = require("@azure/msal-node");
const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const fs = require("fs");
const path = require("path");
const lockPath = path.join(__dirname, "../data/outlook_runner.lock");

async function markMessageAsRead(messageId, accessToken) {
  await axios.patch(
    `https://graph.microsoft.com/v1.0/me/messages/${messageId}`,
    { isRead: true },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    }
  );
}

// ---- CONFIG ----
const RESTAURANT_ID = process.env.RESTAURANT_ID;
const INGEST_URL = process.env.INGEST_URL || "http://localhost:3000/ingest/email";

if (!RESTAURANT_ID) {
  console.error("Missing RESTAURANT_ID env var");
  process.exit(1);
}

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env var");
  process.exit(1);
}

const pca = new PublicClientApplication({
  auth: {
    clientId: process.env.MS_CLIENT_ID,
    authority: "https://login.microsoftonline.com/common",
  },
});

async function loadState() {
  const { data, error } = await supabase
    .from("integration_state")
    .select("state_value")
    .eq("restaurant_id", RESTAURANT_ID)
    .eq("provider", "outlook")
    .eq("state_key", "delta_link")
    .maybeSingle();

  if (error) {
    throw new Error(`loadState failed: ${error.message}`);
  }

  return data?.state_value || { deltaLink: null };
}

async function saveState(state) {
  const { error } = await supabase
    .from("integration_state")
    .upsert(
      [
        {
          restaurant_id: RESTAURANT_ID,
          provider: "outlook",
          state_key: "delta_link",
          state_value: state,
          updated_at: new Date().toISOString(),
        },
      ],
      {
        onConflict: "restaurant_id,provider,state_key",
      }
    );

  if (error) {
    throw new Error(`saveState failed: ${error.message}`);
  }
}

function looksLikeBooking(msg) {
  const text = `${msg.subject || ""}\n${msg.bodyPreview || ""}`.toLowerCase();

  const keywords = [
    "book",
    "booking",
    "reserve",
    "reservation",
    "table",
    "pax",
    "people",
    "tonight",
    "tomorrow",
  ];

  return keywords.some((k) => text.includes(k));
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function toIngestPayload(msg, attachments = []) {
  const fromEmail = msg.from?.emailAddress?.address || "";
  const customerName = null;

  const bodyText =
    msg.body?.contentType === "html"
      ? stripHtml(msg.body?.content || "")
      : String(msg.body?.content || msg.bodyPreview || "");

  const attachmentSummary =
    attachments.length > 0
      ? `\n\nAttachments:\n${attachments
          .map((a) => `- ${a.name} (${a.contentType || "unknown"})`)
          .join("\n")}`
      : "";

  return {
    restaurant_id: RESTAURANT_ID,
    customer_email: fromEmail,
    customer_name: customerName,
    thread_id: msg.conversationId || msg.id,
    message_text: `${msg.subject || ""}\n\n${bodyText}${attachmentSummary}`,
    email_event: {
      message_id: msg.id,
      thread_id: msg.conversationId || msg.id,
      from: fromEmail,
      subject: msg.subject || "",
      body: bodyText,
      received_at: msg.receivedDateTime || null,
      provider: "outlook",
      has_attachments: attachments.length > 0,
      attachments: attachments.map((a) => ({
        id: a.id,
        name: a.name,
        contentType: a.contentType,
        size: a.size,
      })),
    },
  };
}

async function getAccessToken() {
  if (process.env.MS_TOKEN_CACHE) {
    try {
      pca.getTokenCache().deserialize(process.env.MS_TOKEN_CACHE);
      console.log("✅ Token cache loaded");
    } catch (e) {
      console.error("❌ Failed to load token cache", e);
      throw e;
    }
  }

  const accounts = await pca.getTokenCache().getAllAccounts();
  console.log("ACCOUNTS FOUND:", accounts.length);

  if (accounts[0]) {
    console.log("ACCOUNT USERNAME:", accounts[0].username);
  }

  if (!accounts.length) {
    console.log("No account found → starting device login...");

    const result = await pca.acquireTokenByDeviceCode({
      scopes: ["User.Read", "Mail.ReadWrite", "Mail.Send", "offline_access"],
      deviceCodeCallback: (response) => {
        console.log("\n=== DEVICE LOGIN ===");
        console.log(response.message);
        console.log("====================\n");
      },
    });

    return result.accessToken;
  }

  const result = await pca.acquireTokenSilent({
    account: accounts[0],
    scopes: ["User.Read", "Mail.ReadWrite", "Mail.Send", "offline_access"],
  });

  return result.accessToken;
}

function acquireRunnerLock() {
  try {
    if (fs.existsSync(lockPath)) {
      const startedAt = Number(fs.readFileSync(lockPath, "utf-8") || "0");

      // if another runner started in the last 60s, assume it's still active
      if (Date.now() - startedAt < 60000) {
        console.log("Another runner is active. Exiting.");
        return false;
      }
    }

    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, String(Date.now()), "utf-8");
    return true;
  } catch (e) {
    console.error("Failed to acquire runner lock:", e?.message || String(e));
    return false;
  }
}

function releaseRunnerLock() {
  try {
    if (fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath);
    }
  } catch (e) {
    console.error("Failed to release runner lock:", e?.message || String(e));
  }
}

async function main() {
  const locked = acquireRunnerLock();
    if (!locked) return;

  const state = await loadState();
  const accessToken = await getAccessToken();

console.log("LOADED STATE:", JSON.stringify(state, null, 2));
console.log("CURRENT DELTA LINK EXISTS:", !!state.deltaLink);

  console.log("Access token acquired ✅");
  
  const cachePath = path.join(__dirname, "../data/token_cache.json");
fs.mkdirSync(path.dirname(cachePath), { recursive: true });
fs.writeFileSync(cachePath, pca.getTokenCache().serialize(), "utf-8");
console.log("✅ Token cache saved to", cachePath);
 
console.log("CURRENT DELTA LINK EXISTS:", !!state.deltaLink);

  const isFirstRun = !state.deltaLink;

  const deltaUrl =
    state.deltaLink ||
    "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$select=id,subject,from,receivedDateTime,conversationId,bodyPreview";

  const r = await axios.get(deltaUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const messages = r.data.value || [];
  console.log("MESSAGES FOUND:", messages.length);

  const nextDeltaLink = r.data["@odata.deltaLink"] || r.data["@odata.nextLink"];

  if (nextDeltaLink) {
    state.deltaLink = nextDeltaLink;
    await saveState(state);
    console.log("✅ Delta state saved");
  }

    if (isFirstRun) {
    console.log("Initial delta state saved. Skipping old emails.");
    releaseRunnerLock();
    return;
  }

  let processed = 0;
  let skipped = 0;

  for (const msg of messages) {
  console.log("MSG SUBJECT:", msg.subject);
  console.log("MSG FROM:", msg.from?.emailAddress?.address);
  console.log("MSG RECEIVED:", msg.receivedDateTime);
  console.log("MSG ID:", msg.id);
  console.log("MSG THREAD:", msg.conversationId || msg.id);

  const fromEmail = msg.from?.emailAddress?.address || "";

  if (!fromEmail) {
    skipped++;
    continue;
  }

  if (fromEmail.includes("accountprotection.microsoft.com")) {
    skipped++;
    continue;
  }

  try {
    const fullMsg = await fetchFullMessage(msg.id, accessToken);

    let attachments = [];
    if (fullMsg.hasAttachments) {
      try {
        attachments = await fetchAttachments(msg.id, accessToken);
      } catch (e) {
        console.error("ATTACHMENTS FETCH FAILED:", msg.subject, e?.message || String(e));
      }
    }

    const payload = toIngestPayload(fullMsg, attachments);

    const resp = await axios.post(INGEST_URL, payload, {
      headers: { "Content-Type": "application/json" },
    });

    console.log("INGEST RESPONSE STATUS:", resp.status);
    console.log("INGEST RESPONSE DATA:", JSON.stringify(resp.data, null, 2));

    if (resp.data?.skipped) {
      console.log("⛔ Duplicate skipped by ingest:", msg.subject);
    } else {
      console.log("✅ Ingested email:", msg.subject);
    }

    await markMessageAsRead(msg.id, accessToken);
    processed++;
  } catch (err) {
    console.error("INGEST FAILED SUBJECT:", msg.subject);
    console.error("INGEST FAILED STATUS:", err?.response?.status || null);
    console.error(
      "INGEST FAILED DATA:",
      JSON.stringify(err?.response?.data || null, null, 2)
    );
    console.error("INGEST FAILED MESSAGE:", err?.message || String(err));
  }
}

  console.log(`Processed ${processed} emails. Skipped ${skipped} emails.`);
  releaseRunnerLock();
}

main()
  .then(() => {
    console.log("---- RUN END ----");
    process.exit(0);
  })
  .catch((e) => {
    releaseRunnerLock();
    console.error("RUN ERROR MESSAGE:", e?.message || String(e));
    console.error(
      "RUN ERROR DATA:",
      JSON.stringify(e?.response?.data || null, null, 2)
    );
    process.exit(1);
  });

  async function fetchFullMessage(messageId, accessToken) {
  const r = await axios.get(
    `https://graph.microsoft.com/v1.0/me/messages/${messageId}?$select=id,subject,from,receivedDateTime,conversationId,body,bodyPreview,hasAttachments,isRead`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  return r.data;
}