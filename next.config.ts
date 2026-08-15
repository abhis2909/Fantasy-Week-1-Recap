import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // next/image refuses to render any external URL whose host isn't
    // explicitly allowed here — without this, real NHL headshots synced
    // into Player.photoUrl (e.g. https://assets.nhle.com/mugs/nhl/...)
    // silently fail to render even though the URL itself is fine.
    remotePatterns: [{ protocol: "https", hostname: "**.nhle.com" }],
    // next/image also refuses SVGs by default (they can embed scripts) —
    // needed for the generic placeholder avatar (public/images/positions/
    // generic-black.svg), which is our own static asset, not user-supplied.
    // contentSecurityPolicy strips any script capability from served SVGs
    // regardless, per Next.js's own recommendation for this flag.
    dangerouslyAllowSVG: true,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
};

export default nextConfig;
