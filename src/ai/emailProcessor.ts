import OpenAI from "openai";
import { z } from "zod";
import { extractBookingFromText } from "./bookingExtract";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const EmailTypeSchema = z.object({
  type: z.enum(["booking", "function", "supplier", "staff", "spam", "other"]),
  confidence: z.number().min(0).max(1),
  function_data: z
    .object({
      people: z.number().int().positive().nullable(),
      date_hint: z.string().nullable(),
      occasion: z.string().nullable(),
    })
    .nullable()
    .optional()
    .default(null),
});

export async function processIncomingEmail(input: {
  now_perth_iso: string;
  message_text: string;
}) {

const system = `
You classify incoming restaurant emails.
Return ONLY JSON:
{
  "type": "booking" | "function" | "supplier" | "staff" | "spam" | "other",
  "confidence": number (0..1),
  "function_data"?: {
    "people": number | null,
    "date_hint": string | null,
    "occasion": string | null
  }
}
Rules:
- booking: table reservations, modify/cancel reservations
- function: events, groups, weddings, set menu, private dining, large parties
- supplier: invoices, price lists, deliveries, ordering
- staff: resumes, applicants, rostering
- spam: marketing spam, unrelated
- other: anything else
If type=function, include function_data (people/date_hint/occasion) when possible, otherwise nulls.
JSON only.`;

  const resp = await client.responses.create({
    model: "gpt-4.1-mini",
    input: [
      { role: "system", content: system },
      { role: "user", content: input.message_text },
    ],
  });

const raw0 = resp.output_text?.trim() ?? "";

// strip ```json ... ``` or ``` ... ```
const raw = raw0
  .replace(/^```(?:json)?\s*/i, "")
  .replace(/```$/i, "")
  .trim();

let parsedJson: any;
try {
  parsedJson = JSON.parse(raw);
} catch (e) {
  // fallback: try to extract first {...} block
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw e;
  parsedJson = JSON.parse(m[0]);
}

const parsed = EmailTypeSchema.parse(parsedJson);

if (parsed.type === "booking") {
  const booking = await extractBookingFromText(input);
  return { ...parsed, booking };
}

return {
  ...parsed,
  booking: null,
};
}
