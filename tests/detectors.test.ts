import { describe, it, expect } from "vitest";
import { DETECTORS, paise } from "../src/lib/agents/detectors";
import type { Product } from "../src/lib/shopify/catalogue";

const P = (o: Partial<Product> & { handle: string }): Product => ({
  id: "gid://shopify/Product/" + o.handle, title: o.handle, status: "ACTIVE", tags: [], description: "",
  seo: { title: null, description: "ok" }, featuredMedia: { id: "m" }, variants: [], ...o,
});
const V = (price: string | null, compareAtPrice: string | null, sku = "S") => ({ id: "v", sku, price, compareAtPrice });
const det = (id: string) => DETECTORS.find((d) => d.id === id)!;

describe("detectors", () => {
  it("money compares in whole paise, so floating point cannot fake a match", () => {
    expect(paise("1712.00")).toBe(171200);
    expect(paise("0.1")! * 3).toBe(paise("0.3"));
    expect(paise(null)).toBeNull();
    expect(paise("")).toBeNull();
  });

  it("compare-at exactly 2x: matches only exact doubles on active products, counts variants", () => {
    const r = det("compare_at_exactly_2x").run([
      P({ handle: "a", variants: [V("1712.00", "3424.00"), V("1712.00", "3424.01"), V("1712", null)] }),
      P({ handle: "b", status: "DRAFT", variants: [V("100", "200")] }),
      P({ handle: "c", variants: [V("0", "0")] }),
    ]);
    expect(r.scanned).toBe(4);
    expect(r.unit).toBe("variants");
    expect(r.hits.map((h) => h.handle)).toEqual(["a"]);
  });

  it("warranty wording: case-insensitive, any whitespace, title/description/tags", () => {
    const r = det("lifetime_service_warranty_wording").run([
      P({ handle: "a", description: "Comes with LIFETIME  service\nwarranty" }),
      P({ handle: "b", tags: ["Lifetime Service Warranty"] }),
      P({ handle: "c", description: "Lifetime warranty on plating" }),
      P({ handle: "d", status: "ARCHIVED", description: "Lifetime Service Warranty" }),
    ]);
    expect(r.hits.map((h) => h.handle)).toEqual(["a", "b"]);
    expect(r.scanned).toBe(3);
  });

  it("gold plated term: catches spacing/hyphen variants, ignores Gold layered", () => {
    const r = det("gold_plated_term").run([
      P({ handle: "a", title: "Gold-plated Jhumka" }),
      P({ handle: "b", description: "gold   plated finish" }),
      P({ handle: "c", tags: ["Thick Gold Layered"] }),
    ]);
    expect(r.hits.map((h) => h.handle)).toEqual(["a", "b"]);
  });

  it("no image and missing SEO description", () => {
    const ps = [P({ handle: "a", featuredMedia: null }), P({ handle: "b", seo: { title: null, description: "  " } }), P({ handle: "c" })];
    expect(det("no_image").run(ps).hits.map((h) => h.handle)).toEqual(["a"]);
    expect(det("missing_seo_description").run(ps).hits.map((h) => h.handle)).toEqual(["b"]);
  });

  it("every detector has a unique id and fingerprint", () => {
    expect(new Set(DETECTORS.map((d) => d.id)).size).toBe(DETECTORS.length);
    expect(new Set(DETECTORS.map((d) => d.fingerprint)).size).toBe(DETECTORS.length);
  });
});
