import { FunctionKnowledge } from "./functionEngine";

export const functionKnowledgeDemo: FunctionKnowledge = {
  drinks_estimate_pp: 25, // DEMO default
  menus: [
    {
      name: "Feed Me Menu",
      price_pp: 65,
      min_people: 2,
      max_people: 14,
      description: "Focaccia, a choice of main, 2 sides + a dessert per person.",
    },
    {
      name: "Pizza Party Share Menu",
      price_pp: 40,
      min_people: 15,
      max_people: null, // open ended
      description: "A selection of pizza, sides + deli meats and cheese. Designed to share.",
    },
  ],
  add_ons: [
    {
      name: "Deli Board",
      price: 80,
      serves: 6,
      description: "Prime cured meats + cheeses, focaccia, lavosh crackers.",
    },
    {
      name: "Hot Board",
      price: 100,
      serves: 6,
      description: "Croquettes + skewers selection (mix & match).",
    },
  ],
};
