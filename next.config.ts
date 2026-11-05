import type { NextConfig } from "next";

const authURL = process.env.BETTER_AUTH_URL;
const developmentHost =
  authURL && URL.canParse(authURL) ? new URL(authURL).hostname : undefined;

const nextConfig: NextConfig = {
  allowedDevOrigins: developmentHost ? [developmentHost] : [],
};

export default nextConfig;
