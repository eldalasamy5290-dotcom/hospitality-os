import OpenAI from "openai";

import { z } from "zod";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function normalizeTime(t: string | null): string | null {
  if (!t) return null;
  const s = t.trim().toLowerCase();

  // already HH:MM
  if (/^\d{2}:\d{2}$/.test(s)) return s;

  // "7", "19"
  if (/^\d{1,2}$/.test(s)) {
    const h = Number(s);
    if (h >= 0 && h <= 23) return String(h).padStart(2, "0") + ":00";
  }

  // "7pm", "7 pm", "7:30pm", "7:30 pm"
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (m) {
    let h = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    const ap = m[3];
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
      return String(h).padStart(2, "0") + ":" + String(min).padStart(2, "0");
    }
  }

  return null;
}

export const BookingExtractSchema = z.object({
  booking_date_iso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  time: z.preprocess(
    (v) => (typeof v === "string" ? normalizeTime(v) : v),
    z.string().regex(/^\d{2}:\d{2}$/).nullable()
  ),
  people: z.number().int().positive().nullable(),
  dietary: z.string().nullable(),
  occasion: z.string().nullable(),
  intent: z.enum(["new_booking", "modify_booking", "cancel", "other"]),
  confidence: z.number().min(0).max(1),
});

export type BookingExtract = z.infer<typeof BookingExtractSchema>;

export async function extractBookingFromText(input: {
  now_perth_iso: string;
  message_text: string;
}) {
  const system = `
You are a structured data extraction engine for restaurant bookings.
Your job is to extract booking information from customer emails.

Rules:
- Extract only booking information.
- Do not guess missing booking data.
- If the message is not a booking request, set intent to "other" and set all other fields to null.
- booking_date_iso must be normalized to Perth date context using now_perth_iso.
- If date, time, or people are missing, set them to null.
- If the user says "tomorrow", "next Friday", etc., convert it to booking_date_iso.
- Normalize time to HH:MM.
- confidence must be a number between 0 and 1.
- Output JSON only, with no commentary and no markdown.

Return ONLY valid JSON matching this schema:
{
  "booking_date_iso": "YYYY-MM-DD" | null,
  "time": "HH:MM" | null,
  "people": number | null,
  "dietary": string | null,
  "occasion": string | null,
  "intent": "new_booking" | "modify_booking" | "cancel" | "other",
  "confidence": number
}
`;

  const resp = await client.responses.create({
    model: "gpt-4.1-mini",
    input: [
      { role: "system", content: system },
      {
        role: "user",
        content: `now_perth_iso: ${input.now_perth_iso}\n\nmessage_text:\n${input.message_text}`,
      },
    ],
  });

const raw = resp.output_text?.trim() ?? "";
let parsedJson: any;

try {
  parsedJson = JSON.parse(raw);
} catch {
  // fallback: prova a estrarre il primo blocco JSON
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    parsedJson = JSON.parse(raw.slice(start, end + 1));
  } else {
    throw new Error("OpenAI did not return JSON");
  }
}

const parsed = BookingExtractSchema.parse(parsedJson);
return parsed;
}
