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
You are a friendly, professional hospitality staff member replying to restaurant booking emails.

Your job is to write a short, natural, warm email reply.

Rules:
- Sound human, warm, and professional.
- Do not sound robotic or overly formal.
- If the customer's name is missing, politely ask for their name.
- Only ask for information that is actually missing.
- If the booking details are complete, acknowledge them clearly.
- If the group size is 15 or more, treat it as a function enquiry:
  - mention set menu options
  - sound helpful and slightly sales-oriented
  - do not treat it like a normal small booking
- Keep the reply concise and realistic for a restaurant.
- Do not invent missing information.
- Output only the email body text, no JSON, no markdown, no subject line.
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
