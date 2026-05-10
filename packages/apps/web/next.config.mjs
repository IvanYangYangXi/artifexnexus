/** @type {import("next").NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @artifex-nexus/ui 是源码包（exports 直接指向 .tsx），需要 Next 编译
  transpilePackages: ["@artifex-nexus/ui"],
  experimental: {
    // Next 15 默认走 turbopack，对 source-only workspace 包友好
  },
};

export default nextConfig;
