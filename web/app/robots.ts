import type { MetadataRoute } from "next";

import { serverEnv } from "@/lib/env-public";

export default function robots(): MetadataRoute.Robots {
  const { NEXT_PUBLIC_SITE_URL } = serverEnv();

  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: ["/app", "/admin", "/api"] },
    ],
    sitemap: `${NEXT_PUBLIC_SITE_URL}/sitemap.xml`,
  };
}
