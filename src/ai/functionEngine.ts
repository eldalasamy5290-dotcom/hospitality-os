export type FunctionMenu = {
  name: string;
  price_pp: number | null;     // null se non per-person (es. board)
  min_people: number | null;
  max_people: number | null;
  description: string;
};

export type FunctionAddOn = {
  name: string;
  price: number;              // fixed price
  serves: number | null;
  description: string;
};

export type FunctionKnowledge = {
  menus: FunctionMenu[];
  add_ons: FunctionAddOn[];
  drinks_estimate_pp: number; // demo default
};

export type FunctionExtract = {
  people: number | null;
  date_hint: string | null;     // "November", "2026-11-10", etc
  occasion: string | null;      // "wedding dinner", "birthday", "corporate"
  notes: string | null;
};

export function eligibleMenus(knowledge: FunctionKnowledge, people: number) {
  return knowledge.menus.filter((m) => {
    const min = m.min_people ?? 0;
    const max = m.max_people ?? 9999;
    return people >= min && people <= max;
  });
}

export function estimateRevenue(args: {
  people: number;
  chosenMenuPricePP: number; // per-person
  drinksEstimatePP: number;
}) {
  const food = args.people * args.chosenMenuPricePP;
  const drinks = args.people * args.drinksEstimatePP;
  const total = food + drinks;
  return { food, drinks, total };
}

export function buildFunctionEmailDraft(args: {
  restaurantName: string;
  extract: FunctionExtract;
  eligible: FunctionMenu[];
  add_ons: FunctionAddOn[];
}) {
  const people = args.extract.people ?? 0;

  const menuLines = args.eligible.length
    ? args.eligible
        .map((m) => `• ${m.name} – ${m.price_pp ? `$${m.price_pp}pp` : ""}\n  ${m.description}`)
        .join("\n")
    : "• (No suitable set menus found for this group size)";

  const addOnLines = args.add_ons.length
    ? args.add_ons
        .map((a) => `• ${a.name} – $${a.price}${a.serves ? ` (serves ~${a.serves})` : ""}\n  ${a.description}`)
        .join("\n")
    : "";

  const missing: string[] = [];
  if (!args.extract.people) missing.push("guest number");
  if (!args.extract.date_hint) missing.push("preferred date");
  // dietary non mandatory but good to ask

  const ask = missing.length
    ? `Could you please confirm:\n• ${missing.join("\n• ")}\n• any dietary requirements`
    : `Could you please confirm:\n• any dietary requirements\n• any timing preferences`;

  const subject = "Re: event enquiry";

  const body =
`Hi,

Thank you for considering ${args.restaurantName} for your ${args.extract.occasion ?? "event"}.

For a group of around ${people} guests, we reccomend set menu options that suit your group size:

${menuLines}

${addOnLines ? `Optional add-ons:\n${addOnLines}\n` : ""}

${ask}

Once confirmed, we can prepare the full event proposal and next steps.

Best regards,
${args.restaurantName}`;

  return { subject, body };
}
