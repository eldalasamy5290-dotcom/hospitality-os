import "dotenv/config";
import OpenAI from "openai";

async function main() {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const r = await client.responses.create({
    model: "gpt-4.1-mini",
    input: "Say OK"
  });
  console.log(r.output_text);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});