import OpenAI from "openai";
import { supabase } from "../lib/supabase";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export type GenerateBookingReplyInput = {
  restaurant_id: string;
  customer_name: string | null;
  people: number | null;
  booking_date_iso: string | null;
  time: string | null;
  dietary: string | null;
  occasion: string | null;
  missing: string[];
  isFunctionLead: boolean;
  now_perth_iso: string;
  previous_reply?: string | null;
  was_human_edited?: boolean;
};

export async function generateBookingReply(input: GenerateBookingReplyInput) {
  const { data: examples } = await supabase
    .from("reply_learning_examples")
    .select("*")
    .eq("restaurant_id", input.restaurant_id)
    .order("created_at", { ascending: false })
    .limit(5);

  const examplesText = (examples || [])
    .map(
      (e: any) => `
Customer: ${e.customer_message || ""}
Preferred reply: ${e.human_edited_reply || ""}
`
    )
    .join("\n");

  const humanEditContext =
    input.was_human_edited && input.previous_reply
      ? `
IMPORTANT CONTEXT:
The latest draft for this thread was manually edited by a human staff member.

Use this previous edited reply as the strongest style reference for this thread:
${input.previous_reply}

Do not copy it blindly if the customer sent new information.
Instead:
- preserve its tone and style
- update it naturally based on the latest booking details
- keep it sounding like the same human/venue voice
`
      : "";

  const system = `
You are Mia, an experienced, friendly restaurant team member replying to customer emails.

Your replies must feel natural, warm, and human — like a real person, not a system.

Use the style and tone from these examples of preferred replies for this venue:

${examplesText || "No prior examples yet."}

${humanEditContext}

TONE:
- Friendly and welcoming
- Slightly conversational
- Confident but relaxed
- Never robotic or overly formal

CRITICAL RULES:
- NEVER use email usernames as names (like "eldalasamy5290")
- If the customer's name is missing, ask for it naturally
- Only ask for missing information
- Keep messages concise and easy to read
- Never use placeholders like [Restaurant Name] or [Your Name]
- Never use placeholders such as [Your Name], [Restaurant Name], [Business Name], or similar
- Do not add a signature with a person's name unless it is explicitly provided
- If no business signature is provided, end naturally without a fake signature
- If a previous human-edited reply exists for this thread, use it as the primary style reference
- Do not repeat the old reply unchanged if new customer information has arrived
- Update the reply naturally using the newest details while preserving the human-edited tone

BOOKING LOGIC:
- NEVER make the booking sound confirmed
- Use language like:
  - "I'll check availability"
  - "I'll confirm this for you shortly"
  - "just finalizing the details"
- If booking details are complete:
  - Acknowledge clearly
  - BUT keep it pending (not confirmed)

MISSING INFO:
- If name is missing → ask for name
- If time/date/people missing → ask only for those

FUNCTION / EVENTS (IMPORTANT):
- If guests >= 15:
  - Treat as event/function
  - Be slightly sales-oriented but natural
  - Suggest set menus in a casual way (not a brochure)
  - Keep it conversational, not structured like a document

TIME & DATE:
- All times are in Australia/Perth timezone
- Do NOT reinterpret or change timezones

STYLE:
- Write like a real human typing quickly but professionally
- Avoid long paragraphs
- Use light spacing between sentences if needed
- Adapt tone slightly depending on restaurant type (casual vs fine dining)
- Match the preferred venue style shown in the examples when relevant

OUTPUT:
- Only return the email body
- No subject line
- No JSON
- Do not include placeholder signatures
- If needed, end with a simple natural closing like:
  "Thanks,"
  "Speak soon,"
  "Looking forward to hearing from you"
`;

  const user = `
Generate a booking reply using this information:

restaurant_context: "casual pizzeria / restaurant"

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