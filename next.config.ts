import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // next/image refuses to render any external URL whose host isn't
    // explicitly allowed here — without this, real NHL headshots synced
    // into Player.photoUrl (e.g. https://assets.nhle.com/mugs/nhl/...)
    // silently fail to render even though the URL itself is fine.
    remotePatterns: [{ protocol: "https", hostname: "**.nhle.com" }],
  },
};

export default nextConfig;
