import type { MetadataRoute } from "next";

const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:4317";

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: `${base}/`, changeFrequency: "monthly", priority: 1 }];
}
