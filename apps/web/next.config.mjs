/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@repo/database", "@repo/shared"],
  // playwright-core + @sparticuz/chromium-min ship/fetch native binaries --
  // keep them out of webpack's JS bundling (api/track/route.ts's live
  // search, PRD.md FR-18). -min fetches its Chromium pack from a remote URL
  // at cold start rather than bundling it, so unlike the full
  // @sparticuz/chromium package, there's no large binary for Vercel's
  // build tracer/packager to mishandle through pnpm's symlinked node_modules.
  serverExternalPackages: ["playwright-core", "@sparticuz/chromium-min"],
};

export default nextConfig;
