/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@repo/database", "@repo/shared"],
  // playwright-core + @sparticuz/chromium ship native binaries -- keep them
  // out of webpack's JS bundling and let Vercel's build tracer include the
  // files as-is (api/track/route.ts's live search, PRD.md FR-18).
  serverExternalPackages: ["playwright-core", "@sparticuz/chromium"],
  // @sparticuz/chromium resolves its bin/*.br files via import.meta.url at
  // runtime, which Next's static file tracer can't follow -- without this,
  // the compressed Chromium binary is silently dropped from the deployed
  // function and executablePath() fails at runtime, not at build time.
  outputFileTracingIncludes: {
    "/api/track": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
};

export default nextConfig;
