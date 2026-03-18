const axios = require("axios");
const { PublicClientApplication } = require("@azure/msal-node");
const fs = require("fs");
const path = require("path");

const TOKEN_PATH = path.join(__dirname, "../data/token_cache.json");

const WEBHOOK_URL = process.env.WEBHOOK_URL; // full URL
const CLIENT_STATE = process.env.CLIENT_STATE || "hos_secret_123";

const pca = new PublicClientApplication({
  auth: {
    clientId: process.env.MS_CLIENT_ID,
    authority: "https://login.microsoftonline.com/consumers",
  },
  cache: {
    cachePlugin: {
      beforeCacheAccess: async (ctx) => {
        if (fs.existsSync(TOKEN_PATH)) ctx.tokenCache.deserialize(fs.readFileSync(TOKEN_PATH, "utf-8"));
      },
      afterCacheAccess: async (ctx) => {
        if (ctx.cacheHasChanged) fs.writeFileSync(TOKEN_PATH, ctx.tokenCache.serialize());
      },
    },
  },
});

async function getAccessToken() {
  const accounts = await pca.getTokenCache().getAllAccounts();
  if (accounts.length === 0) {
    throw new Error("No cached account. Run runOutlookPoll.js once to login and cache token.");
  }
  const r = await pca.acquireTokenSilent({
    account: accounts[0],
    scopes: ["User.Read", "Mail.Read", "offline_access"],
  });
  return r.accessToken;
}

(async () => {
  if (!WEBHOOK_URL) throw new Error("Missing WEBHOOK_URL env var");

  const accessToken = await getAccessToken();

  const expirationDateTime = new Date(Date.now() + 55 * 60 * 1000).toISOString();

  const body = {
    changeType: "created",
    notificationUrl: WEBHOOK_URL,
    resource: "me/mailFolders('inbox')/messages",
    expirationDateTime,
    clientState: CLIENT_STATE,
  };

  const r = await axios.post("https://graph.microsoft.com/v1.0/subscriptions", body, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  console.log("Subscription created ✅");
  console.log(r.data);
})().catch((e) => {
  console.error("FAILED:", e?.response?.data || e?.message || e);
  process.exit(1);
});
