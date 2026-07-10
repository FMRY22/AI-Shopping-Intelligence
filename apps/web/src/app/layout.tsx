import type { Metadata } from "next";
import "./globals.css";

// Bilingual/RTL (PRD.md FR-19, UI.md §2) is wired up once auth/profiles
// exist (`profiles.locale`, DATABASE.md §8) in a later feature slice --
// this first slice is deliberately English/LTR-only, proving the data
// pipeline before the localization layer sits on top of it.
export const metadata: Metadata = {
  title: "AI Shopping Intelligence",
  description: "Proactive, explainable shopping intelligence for Saudi Arabia.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr">
      <body>{children}</body>
    </html>
  );
}
