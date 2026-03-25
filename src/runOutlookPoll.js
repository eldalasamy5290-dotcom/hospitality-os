require("dotenv").config();

const { PublicClientApplication } = require("@azure/msal-node");
const fs = require("fs");
const path = require("path");
const axios = require("axios");

console.log("RUNOUTLOOKPOLL DEBUG V2 LOADED");

// ---- CONFIG ----
const RESTAURANT_ID = process.env.RESTAURANT_ID; // UUID del ristorante
const INGEST_URL = process.env.INGEST_URL || "http://localhost:3000/ingest/email";

// ---- STATE (deltaLink) ----
const STATE_PATH = path.join(__dirname, "../data/outlook_state.json");
const STATE_DIR = path.dirname(STATE_PATH);

function ensureStateDir() {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }
}

function loadState() {
  ensureStateDir();

  if (fs.existsSync(STATE_PATH)) {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf-8"));
  }

  return { deltaLink: null };
}

function saveState(state) {
  ensureStateDir();
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

const state = loadState();

if (!RESTAURANT_ID) {
  console.error("Missing RESTAURANT_ID env var");
  process.exit(1);
}

const pca = new PublicClientApplication({
  auth: {
    clientId: process.env.MS_CLIENT_ID,
    authority: "https://login.microsoftonline.com/common",
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

let result;

if (!accounts.length) {
  console.log("No account found → starting device login...");

  try {
    result = await pca.acquireTokenByDeviceCode({
      scopes: ["User.Read", "Mail.Read", "Mail.Send", "offline_access"],
      deviceCodeCallback: (response) => {
        console.log("\n=== DEVICE LOGIN ===");
        console.log(response.message);
        console.log("====================\n");
      },
    });
  } catch (e) {
    console.error("❌ Device login failed:", e?.message || e);
    return;
  }
} else {
  try {
    result = await pca.acquireTokenSilent({
      account: accounts[0],
      scopes: ["User.Read", "Mail.Read", "Mail.Send", "offline_access"],
    });
  } catch (e) {
    console.error("❌ Silent token failed:", e?.message || e);
    return;
  }
}

console.log("Access token acquired ✅");

// TEMP DEBUG: reset delta state

const isFirstRun = !state.deltaLink;

const deltaUrl =
  state.deltaLink ||
  "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$select=id,subject,from,receivedDateTime,conversationId,bodyPreview";

const r = await axios.get(deltaUrl, {
  headers: { Authorization: `Bearer ${result.accessToken}` },
});

const messages = r.data.value || [];
console.log("MESSAGES FOUND:", messages.length);

const deltaLink = r.data["@odata.deltaLink"] || r.data["@odata.nextLink"];

if (deltaLink) {
  state.deltaLink = deltaLink;
  saveState(state);
}

if (isFirstRun) {
  console.log("Initial delta state saved. Skipping old emails.");
  return;
}

let processed = 0;

for (const msg of messages) {
  console.log("MSG SUBJECT:", msg.subject);
  console.log("MSG FROM:", msg.from?.emailAddress?.address);
  console.log("MSG RECEIVED:", msg.receivedDateTime);

  const fromEmail = msg.from?.emailAddress?.address || "";
  if (!fromEmail) continue;

  if (!fromEmail) continue;

  if (fromEmail.includes("accountprotection.microsoft.com")) continue;

  if (!looksLikeBooking(msg)) continue;

  const payload = toIngestPayload(msg);

  try {
    const resp = await axios.post(INGEST_URL, payload, {
      headers: { "Content-Type": "application/json" },
    });

    console.log("INGEST RESPONSE STATUS:", resp.status);
    console.log("INGEST RESPONSE DATA:", JSON.stringify(resp.data, null, 2));
  } catch (err) {
    console.error("INGEST FAILED SUBJECT:", msg.subject);
    console.error("INGEST FAILED STATUS:", err?.response?.status || null);
    console.error(
      "INGEST FAILED DATA:",
      JSON.stringify(err?.response?.data || null, null, 2)
    );
    console.error("INGEST FAILED MESSAGE:", err?.message || String(err));
  }

  console.log("Ingested email:", msg.subject);
  processed++;
}

  console.log(`Processed ${processed} emails.`);
}

async function runLoop() {
  while (true) {
    try {
      console.log("---- RUN START ----");
      await main();
      console.log("---- RUN END ----");
    } catch (e) {
      console.error("LOOP ERROR MESSAGE:", e?.message || String(e));
      console.error(
        "LOOP ERROR DATA:",
        JSON.stringify(e?.response?.data || null, null, 2)
      );
    }

    // aspetta 10 secondi
    await new Promise((r) => setTimeout(r, 10000));
  }
}

runLoop();
