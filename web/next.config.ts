import type { NextConfig } from "next";

const isStaticExport = process.env.STATIC_EXPORT === "1";
const basePath = process.env.NEXT_BASE_PATH || "";

const nextConfig: NextConfig = {
  ...(isStaticExport ? { output: "export" as const, trailingSlash: true } : {}),
  ...(basePath ? { basePath } : {}),
  ...(!isStaticExport
    ? {
        async rewrites() {
          return [
            {
              source: "/api/:path*",
              destination: `${process.env.API_URL || "http://127.0.0.1:8001"}/api/:path*`,
            },
          ];
        },
      }
    : {}),
};

export default nextConfig;
