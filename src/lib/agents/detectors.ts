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

/** Everything a customer or a search engine reads as copy: title, description, tags, SEO title and description. */
const textOf = (p: Product) => [p.title, p.description, ...(p.tags ?? []), p.seo?.title ?? "", p.seo?.description ?? ""].join(" \n ");

/** Which field a pattern was found in, for the evidence sample. */
function where(p: Product, re: RegExp): string {
  const fields: [string, string][] = [["title", p.title], ["description", p.description], ["tags", (p.tags ?? []).join(", ")], ["SEO title", p.seo?.title ?? ""], ["SEO description", p.seo?.description ?? ""]];
  return fields.filter(([, v]) => re.test(v)).map(([k]) => k).join(" + ");
}

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
    id: "lifetime_warranty_claim",
    agentId: "seo_content",
    area: "seo_content",
    fingerprint: "content:lifetime-warranty-claim:active-products",
    title: "“Lifetime warranty” promised in product copy",
    check: "Active products whose title, description, tags, SEO title or SEO description say “lifetime warranty” or “lifetime service warranty”. Approved policy: 2-year warranty (3 Premium, 5 idol colour); only paid service is lifetime.",
    run(products) {
      const ps = active(products);
      const re = /lifetime\s+(service\s+)?warrant(y|ies)/i;
      const hits = ps.filter((p) => re.test(textOf(p))).map((p) => ({ handle: p.handle, detail: `${p.title} [${where(p, re)}]` }));
      return { scanned: ps.length, unit: "products", hits };
    },
  },
  {
    id: "gold_plated_term",
    agentId: "catalogue",
    area: "catalogue",
    fingerprint: "catalogue:gold-plated-term:active-products",
    title: "“Gold plated” used where the approved term is “Gold layered”",
    check: "Active products whose title, description, tags, SEO title or SEO description say “gold plated” / “gold-plated” (approved brand term is “Gold layered”)",
    run(products) {
      const ps = active(products);
      const re = /gold[\s-]*plated/i;
      const hits = ps.filter((p) => re.test(textOf(p))).map((p) => ({ handle: p.handle, detail: `${p.title} [${where(p, re)}]` }));
      return { scanned: ps.length, unit: "products", hits };
    },
  },
  {
    id: "gold_plated_in_url",
    agentId: "seo_content",
    area: "seo_content",
    fingerprint: "seo:gold-plated-in-url-handle:active-products",
    title: "“gold-plated” in product web addresses",
    check: "Active products whose URL handle contains “gold-plated”. Changing a handle needs a 301 redirect from the old address, so this is a separate fix from the copy.",
    run(products) {
      const ps = active(products);
      const hits = ps.filter((p) => /gold-?plated/i.test(p.handle)).map((p) => ({ handle: p.handle, detail: p.title }));
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
