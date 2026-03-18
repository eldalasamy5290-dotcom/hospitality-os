const axios = require("axios");
const { PublicClientApplication } = require("@azure/msal-node");
const fs = require("fs");
const path = require("path");

const TOKEN_PATH = path.join(__dirname, "../data/token_cache.json");

const SUBSCRIPTION_ID = process.env.SUBSCRIPTION_ID;
if (!SUBSCRIPTION_ID) {
  console.error("Missing SUBSCRIPTION_ID env var");
  process.exit(1);
}

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
  if (accounts.length === 0) throw new Error("No cached account. Run runOutlookPoll.js once.");
  const r = await pca.acquireTokenSilent({
    account: accounts[0],
    scopes: ["User.Read", "Mail.Read", "offline_access"],
  });
  return r.accessToken;
}

(async () => {
  const accessToken = await getAccessToken();

  // Extend ~55 minutes (dev-friendly)
  const expirationDateTime = new Date(Date.now() + 55 * 60 * 1000).toISOString();

  const r = await axios.patch(
    `https://graph.microsoft.com/v1.0/subscriptions/${SUBSCRIPTION_ID}`,
    { expirationDateTime },
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  console.log("Subscription renewed ✅");
  console.log(r.data);
})().catch((e) => {
  console.error("FAILED:", e?.response?.data || e?.message || e);
  process.exit(1);
});
