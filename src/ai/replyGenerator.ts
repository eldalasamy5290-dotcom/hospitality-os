import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type GenerateBookingReplyInput = {
  customer_name: string | null;
  people: number | null;
  booking_date_iso: string | null;
  time: string | null;
  dietary: string | null;
  occasion: string | null;
  missing: string[];
  isFunctionLead: boolean;
};

export async function generateBookingReply(input: GenerateBookingReplyInput) {
  const system = `
You are an experienced, friendly restaurant staff member.

Write replies that feel natural, warm, and human — like a real person working in hospitality.

Tone:
- Friendly and welcoming
- Slightly conversational
- Not overly formal
- Never robotic

Rules:
- NEVER use email usernames as names (like "eldalasamy5290")
- If the customer's name is missing, ask for it naturally
- Only ask for missing information
- Do not sound like a system or template

Booking logic:
- If booking is complete, acknowledge it but do NOT fully confirm
- Keep it "pending confirmation"

Function logic:
- If guests >= 15:
  - Treat as event/function
  - Be slightly sales-oriented
  - Suggest set menus naturally
  - Keep tone conversational, not like a document

Keep responses concise and realistic.
No placeholders like [Restaurant Name].
Only output the email body.
`;

  const user = `
Generate a booking reply using this information:

customer_name: ${input.customer_name ?? "null"}
people: ${input.people ?? "null"}
booking_date_iso: ${input.booking_date_iso ?? "null"}
time: ${input.time ?? "null"}
dietary: ${input.dietary ?? "null"}
occasion: ${input.occasion ?? "null"}
missing_fields: ${input.missing.length ? input.missing.join(", ") : "none"}
is_function_lead: ${input.isFunctionLead ? "true" : "false"}
`;

  const resp = await client.responses.create({
    model: "gpt-4.1-mini",
    input: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  const text = resp.output_text?.trim();

  if (!text) {
    throw new Error("OpenAI did not return a reply body");
  }

  return text;
}