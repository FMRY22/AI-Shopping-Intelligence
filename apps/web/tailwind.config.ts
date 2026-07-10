import type { Config } from "tailwindcss";

// UI.md §2: paired Arabic/Latin typography and semantic verdict/status
// tokens are introduced in the UI implementation slice that builds the
// Verdict Card and other packages/ui components -- this first slice keeps
// the Tailwind config minimal, matching its read-only proof-of-pipeline
// scope (UI.md §8 "Next Steps").
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {},
  },
  darkMode: "media",
  plugins: [],
};

export default config;
