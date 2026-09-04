import type { MetadataRoute } from "next";

import { SLUG_FORMATION_PRINCIPALE, recupererCours } from "@/lib/catalog";
import { serverEnv } from "@/lib/env-public";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { NEXT_PUBLIC_SITE_URL } = serverEnv();
  const cours = await recupererCours(SLUG_FORMATION_PRINCIPALE);

  const entrees: MetadataRoute.Sitemap = [
    { url: NEXT_PUBLIC_SITE_URL, changeFrequency: "weekly", priority: 1 },
  ];

  if (cours) {
    for (const mod of cours.modules) {
      for (const chapitre of mod.chapters) {
        if (chapitre.is_free) {
          entrees.push({
            url: `${NEXT_PUBLIC_SITE_URL}/gratuit/${chapitre.slug}`,
            changeFrequency: "monthly",
            priority: 0.8,
          });
        }
      }
    }
  }

  return entrees;
}
