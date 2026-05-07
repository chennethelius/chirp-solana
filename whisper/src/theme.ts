// Whisper — refined Apple-Wallet-inspired dark palette.
//
// The whole interface is graphite + bone-white. There is exactly one
// accent — a warm amber that signals motion + money. The discipline is
// the design: never let the accent sprawl across more than the most
// important call-to-action on a screen. Hairlines, generous space,
// and weight-driven typography do the rest.
export const COLORS = {
  // Surfaces
  bg: "#08080B", // near-black canvas
  paper: "#15151B", // elevated card
  paperDeep: "#0F0F14", // recessed
  paperHigh: "#1E1E25", // hover/pressed card
  border: "#26262E", // hairline
  borderSoft: "#33333D",

  // Type
  ink: "#F5F5F7", // primary text (Apple white)
  inkSoft: "#9A9AA1", // secondary
  inkMuted: "#5C5C65", // tertiary, captions, mono

  // The single accent (warm amber / honey)
  accent: "#FFB44A",
  accentBright: "#FFD37A",
  accentDeep: "#B5781E",
  accentSoft: "#241A0A", // accent-tinted dark surface
  accentInk: "#FFEAB8", // text that sits on accentSoft

  // Semantic — used sparingly. Success borrows the accent on a tinted bg.
  red: "#FF453A",
  redSoft: "#2A1212",

  // Legacy green keys kept (now mapped to the accent) so any straggler
  // imports we missed don't crash. Eventually all uses are migrated.
  green: "#FFB44A",
  greenBright: "#FFD37A",
  greenDark: "#B5781E",
  greenSoft: "#241A0A",
  greenInk: "#FFEAB8",
  yellow: "#FFB44A",
  yellowSoft: "#241A0A",
  blue: "#9DBBE0", // calm cool tint, used only on Merchant explainer disc
  blueSoft: "#13181F",
  purple: "#C7B2D8",
} as const;
