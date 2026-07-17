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

// A sticky top bar with an actual wordmark, instead of a plain <h1> buried
// in page content -- the flat black/white/gray palette plus no header
// identity was what made the product feel bare (founder feedback,
// 2026-07-17: "still feels primitive"). One accent color (indigo) used
// consistently for interactive elements is the other half of that fix,
// applied in product-browser.tsx; semantic colors (green=in stock,
// red=error) stay separate from it on purpose.
function SiteHeader() {
  return (
    <header className="sticky top-0 z-10 border-b border-gray-200 bg-white/80 backdrop-blur-sm dark:border-white/10 dark:bg-[#0b0b0d]/80">
      <div className="mx-auto flex max-w-5xl items-center gap-2.5 px-6 py-3.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white dark:bg-indigo-500">
          Ai
        </span>
        <span className="text-[15px] font-semibold tracking-tight text-gray-900 dark:text-white">
          Shopping Intelligence
        </span>
      </div>
    </header>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr">
      <body className="antialiased">
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
