import fs from "fs";
import path from "path";
import axios from "axios";
import { PublicClientApplication } from "@azure/msal-node";

const TOKEN_PATH = path.join(process.cwd(), "data", "token_cache.json");

const pca = new PublicClientApplication({
  auth: {
    clientId: process.env.MS_CLIENT_ID!,
    authority: "https://login.microsoftonline.com/common",
  },
});

const GRAPH_SCOPES = ["User.Read", "Mail.Read", "Mail.Send", "offline_access"];

function isRailway(): boolean {
  return !!process.env.RAILWAY_ENVIRONMENT || !!process.env.RAILWAY_PROJECT_ID;
}

async function loadTokenCache() {
  if (process.env.MS_TOKEN_CACHE) {
    try {
      pca.getTokenCache().deserialize(process.env.MS_TOKEN_CACHE);
      console.log("✅ Graph token cache loaded from env");
      return "env";
    } catch (e) {
      console.error("❌ Failed to load MS_TOKEN_CACHE from env", e);
      throw new Error("Invalid MS_TOKEN_CACHE in environment");
    }
  }

  if (fs.existsSync(TOKEN_PATH)) {
    try {
      pca.getTokenCache().deserialize(fs.readFileSync(TOKEN_PATH, "utf-8"));
      console.log("✅ Graph token cache loaded from file");
      return "file";
    } catch (e) {
      console.error("❌ Failed to load token cache file", e);
      throw new Error("Invalid local token cache file");
    }
  }

  if (isRailway()) {
    throw new Error(
      "Microsoft Graph is not authenticated on Railway. Missing MS_TOKEN_CACHE."
    );
  }

  throw new Error("No Microsoft token cache found");
}

async function getGraphAccessToken(): Promise<string> {
  const cacheSource = await loadTokenCache();

  const accounts = await pca.getTokenCache().getAllAccounts();

  console.log("📨 Graph accounts in cache:", {
    count: accounts.length,
    source: cacheSource,
    railway: isRailway(),
  });

  if (!accounts.length) {
    throw new Error(
      "No Microsoft account found in token cache for sendMailViaGraph"
    );
  }

  try {
    const result = await pca.acquireTokenSilent({
      account: accounts[0],
      scopes: GRAPH_SCOPES,
    });

    if (!result?.accessToken) {
      throw new Error("Could not acquire Microsoft Graph access token");
    }

    return result.accessToken;
  } catch (err: any) {
    const details = err?.message || String(err);
    console.error("❌ acquireTokenSilent failed:", details);
    throw new Error(`Microsoft silent token acquisition failed: ${details}`);
  }
}

export async function sendMailViaGraph(params: {
  to: string;
  subject: string;
  text: string;
  inReplyTo?: string;
}): Promise<void> {
  const accessToken = await getGraphAccessToken();

  const payload: any = {
    message: {
      subject: params.subject,
      body: {
        contentType: "Text",
        content: params.text,
      },
      toRecipients: [
        {
          emailAddress: {
            address: params.to,
          },
        },
      ],
    },
    saveToSentItems: true,
  };

  if (params.inReplyTo) {
    payload.message.internetMessageHeaders = [
      { name: "In-Reply-To", value: params.inReplyTo },
      { name: "References", value: params.inReplyTo },
    ];
  }

  try {
    await axios.post("https://graph.microsoft.com/v1.0/me/sendMail", payload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    });

    console.log("✅ Graph sendMail success", {
      to: params.to,
      subject: params.subject,
    });
  } catch (err: any) {
    const details =
      err?.response?.data ??
      err?.message ??
      "Unknown Graph sendMail error";

    console.error("❌ sendMailViaGraph failed:", JSON.stringify(details, null, 2));
    throw new Error(
      typeof details === "string" ? details : JSON.stringify(details)
    );
  }
}