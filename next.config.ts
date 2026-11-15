import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // The capture runtime that sdk.js imports on customer pages (scripts/build-sdk.mjs). A module is fetched
  // with CORS, so a page on another origin can load it only with this header. Its name carries a hash of
  // its content, so it is cached for good.
  async headers() {
    return [
      {
        source: "/sdk/:file*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
