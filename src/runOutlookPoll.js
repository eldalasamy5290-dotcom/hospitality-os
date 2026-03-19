require("dotenv").config();

const { PublicClientApplication } = require("@azure/msal-node");
const fs = require("fs");
const path = require("path");
const axios = require("axios");

// ---- CONFIG ----
const RESTAURANT_ID = process.env.RESTAURANT_ID; // UUID del ristorante
const INGEST_URL = process.env.INGEST_URL || "http://localhost:3000/ingest/email";

// ---- STATE (deltaLink) ----
const STATE_PATH = path.join(__dirname, "../data/outlook_state.json");

function loadState() {
  if (fs.existsSync(STATE_PATH)) {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf-8"));
  }
  return { deltaLink: null };
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

const state = loadState();

if (!RESTAURANT_ID) {
  console.error("Missing RESTAURANT_ID env var");
  process.exit(1);
}

const TOKEN_PATH = path.join(__dirname, "../data/token_cache.json");

const pca = new PublicClientApplication({
  auth: {
    clientId: process.env.MS_CLIENT_ID,
    authority: "https://login.microsoftonline.com/common",
  },
  cache: {
    cachePlugin: {
      beforeCacheAccess: async (cacheContext) => {
        if (fs.existsSync(TOKEN_PATH)) {
          cacheContext.tokenCache.deserialize(
            fs.readFileSync(TOKEN_PATH, "utf-8")
          );
        }
      },
      afterCacheAccess: async (cacheContext) => {
        if (cacheContext.cacheHasChanged) {
          fs.writeFileSync(
            TOKEN_PATH,
            cacheContext.tokenCache.serialize()
          );
        }
      },
    },
  },
});

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

function toIngestPayload(msg) {
  const fromEmail = msg.from?.emailAddress?.address || "";
  const customerName = fromEmail ? fromEmail.split("@")[0] : "Unknown";

  return {
    restaurant_id: RESTAURANT_ID,
    customer_email: fromEmail,
    customer_name: customerName,
    thread_id: msg.conversationId || msg.id,
    message_text: `${msg.subject}\n\n${msg.bodyPreview}`,
    email_event: {
      message_id: msg.id,
      thread_id: msg.conversationId || msg.id,
      from: fromEmail,
      subject: msg.subject,
      body: msg.bodyPreview,
      received_at: msg.receivedDateTime || null,
      provider: "outlook",
    },
  };
}

async function main() {
  if (process.env.MS_TOKEN_CACHE) {
    try {
      pca.getTokenCache().deserialize(process.env.MS_TOKEN_CACHE);
      console.log("✅ Token cache loaded");
    } catch (e) {
      console.error("❌ Failed to load token cache", e);
      return;
    }
  }

  const accounts = await pca.getTokenCache().getAllAccounts();
  console.log("ACCOUNTS FOUND:", accounts.length);
  if (accounts[0]) {
    console.log("ACCOUNT USERNAME:", accounts[0].username);
  }

  if (!accounts.length) {
    console.error("❌ No cached account found");
    return;
  }

  let result;
  try {
    result = await pca.acquireTokenSilent({
      account: accounts[0],
      scopes: ["User.Read", "Mail.Read", "Mail.Send", "offline_access"],
    });
  } catch (e) {
    console.error("❌ Silent token failed:", e?.message || e);
    return;
  }

  console.log("Access token acquired ✅");

  const deltaUrl =
    state.deltaLink ||
    "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$select=id,subject,from,receivedDateTime,conversationId,bodyPreview";

  const r = await axios.get(deltaUrl, {
    headers: { Authorization: `Bearer ${result.accessToken}` },
  });

  const messages = r.data.value || [];
  const deltaLink = r.data["@odata.deltaLink"] || r.data["@odata.nextLink"];

  if (deltaLink) {
    state.deltaLink = deltaLink;
    saveState(state);
  }

  let processed = 0;

  for (const msg of messages) {
    const fromEmail = msg.from?.emailAddress?.address || "";
    if (!fromEmail) continue;

    const payload = toIngestPayload(msg);

    await axios.post(INGEST_URL, payload, {
      headers: { "Content-Type": "application/json" },
    });

    console.log("Ingested email:", msg.subject);
    processed++;
  }

  console.log(`Processed ${processed} emails.`);
}

main().catch((e) => {
  console.error("FAILED:", e?.response?.data || e?.message || e);
  process.exit(1);
});
