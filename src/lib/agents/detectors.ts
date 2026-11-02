// Detectors: pure rules over a catalogue snapshot. No I/O here, so every rule
// is unit-tested. Each one is a defect CLASS: one finding with a count, never
// one finding per product.
import type { Product } from "../shopify/catalogue";

export type Area = "catalogue" | "seo_content" | "pricing_offers";
export type Hit = { handle: string; detail: string };
export type Detection = { scanned: number; unit: string; hits: Hit[] };

export type Detector = {
  id: string;            // stable; part of the fingerprint
  agentId: string;       // which desk on the floor runs it
  area: Area;
  fingerprint: string;   // identity of the defect class
  title: string;         // finding title when filed
  check: string;         // what it counts and where, in plain words
  run(products: Product[]): Detection;
};

const active = (ps: Product[]) => ps.filter((p) => p.status === "ACTIVE");

/** Money as integer paise, so 2 × price is compared exactly. */
export function paise(v: string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

const textOf = (p: Product) => [p.title, p.description, ...(p.tags ?? [])].join(" \n ");

export const DETECTORS: Detector[] = [
  {
    id: "compare_at_exactly_2x",
    agentId: "pricing_offers",
    area: "pricing_offers",
    fingerprint: "pricing:compare-at-exactly-2x:active-variants",
    title: "Compare-at price set to exactly 2× the selling price",
    check: "Active product variants whose compare-at price is exactly twice the selling price (Shopify catalogue, read-only)",
    run(products) {
      const ps = active(products);
      const hits: Hit[] = [];
      let variants = 0;
      for (const p of ps) for (const v of p.variants) {
        variants++;
        const price = paise(v.price), cap = paise(v.compareAtPrice);
        if (price && cap && price > 0 && cap === 2 * price) hits.push({ handle: p.handle, detail: `${v.sku ?? v.id}: ${v.compareAtPrice} vs ${v.price}` });
      }
      return { scanned: variants, unit: "variants", hits };
    },
  },
  {
    id: "lifetime_service_warranty_wording",
    agentId: "seo_content",
    area: "seo_content",
    fingerprint: "content:lifetime-service-warranty:active-products",
    title: "“Lifetime Service Warranty” wording live on product pages",
    check: "Active products whose title, description or tags contain “Lifetime Service Warranty” (case-insensitive)",
    run(products) {
      const ps = active(products);
      const hits = ps.filter((p) => /lifetime\s+service\s+warranty/i.test(textOf(p))).map((p) => ({ handle: p.handle, detail: p.title }));
      return { scanned: ps.length, unit: "products", hits };
    },
  },
  {
    id: "gold_plated_term",
    agentId: "catalogue",
    area: "catalogue",
    fingerprint: "catalogue:gold-plated-term:active-products",
    title: "“Gold plated” used where the approved term is “Gold layered”",
    check: "Active products whose title, description or tags say “gold plated” / “gold-plated” (approved brand term is “Gold layered”)",
    run(products) {
      const ps = active(products);
      const hits = ps.filter((p) => /gold[\s-]*plated/i.test(textOf(p))).map((p) => ({ handle: p.handle, detail: p.title }));
      return { scanned: ps.length, unit: "products", hits };
    },
  },
  {
    id: "no_image",
    agentId: "catalogue",
    area: "catalogue",
    fingerprint: "catalogue:no-image:active-products",
    title: "Active products with no image",
    check: "Active products with no featured media in Shopify",
    run(products) {
      const ps = active(products);
      const hits = ps.filter((p) => !p.featuredMedia).map((p) => ({ handle: p.handle, detail: p.title }));
      return { scanned: ps.length, unit: "products", hits };
    },
  },
  {
    id: "missing_seo_description",
    agentId: "seo_content",
    area: "seo_content",
    fingerprint: "seo:missing-meta-description:active-products",
    title: "Active products with no SEO meta description",
    check: "Active products whose SEO description field is empty (Shopify then falls back to the product description)",
    run(products) {
      const ps = active(products);
      const hits = ps.filter((p) => !(p.seo?.description ?? "").trim()).map((p) => ({ handle: p.handle, detail: p.title }));
      return { scanned: ps.length, unit: "products", hits };
    },
  },
];
