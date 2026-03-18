import fs from "fs";
import path from "path";
import axios from "axios";
import { PublicClientApplication } from "@azure/msal-node";

const TOKEN_PATH = path.join(process.cwd(), "data", "token_cache.json");

const pca = new PublicClientApplication({
  auth: {
    clientId: process.env.MS_CLIENT_ID!,
    authority: "https://login.microsoftonline.com/consumers",
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
          fs.writeFileSync(TOKEN_PATH, cacheContext.tokenCache.serialize());
        }
      },
    },
  },
});

const GRAPH_SCOPES = ["User.Read", "Mail.Read", "Mail.Send", "offline_access"];

async function getGraphAccessToken(): Promise<string> {
  const accounts = await pca.getTokenCache().getAllAccounts();

  let result;

  if (accounts.length > 0) {
    result = await pca.acquireTokenSilent({
      account: accounts[0],
      scopes: GRAPH_SCOPES,
    });
  } else {
    result = await pca.acquireTokenByDeviceCode({
      scopes: GRAPH_SCOPES,
      deviceCodeCallback: (response) => {
        console.log("\n=== DEVICE LOGIN ===");
        console.log(response.message);
        console.log("====================\n");
      },
    });
  }

  if (!result?.accessToken) {
    throw new Error("Could not acquire Microsoft Graph access token");
  }

  return result.accessToken;
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

  await axios.post("https://graph.microsoft.com/v1.0/me/sendMail", payload, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });
}
