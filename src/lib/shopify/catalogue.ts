// One read of the whole catalogue through a bulk operation, shared by every
// detector in the same run. Bulk operations are Shopify's supported way to
// read thousands of products without paging against rate limits.
import "server-only";
import { gql } from "./client";

export type Variant = { id: string; sku: string | null; price: string | null; compareAtPrice: string | null };
export type Product = {
  id: string; handle: string; title: string; status: string; tags: string[];
  description: string; seo: { title: string | null; description: string | null };
  featuredMedia: { id: string } | null; variants: Variant[];
};
export type Catalogue = { products: Product[]; readAt: string; bulkOperationId: string };

const BULK_QUERY = `{
  products {
    edges { node {
      id handle title status tags description
      seo { title description }
      featuredMedia { id }
      variants { edges { node { id sku price compareAtPrice } } }
    } }
  }
}`;

type RunResult = { bulkOperationRunQuery: { bulkOperation: { id: string; status: string } | null; userErrors: { message: string }[] } };
type PollResult = { node: { status: string; url: string | null; errorCode: string | null; objectCount: string } | null };

export async function readCatalogue(maxWaitMs = 240_000): Promise<Catalogue> {
  const started = await gql<RunResult>(
    `mutation run($q: String!) { bulkOperationRunQuery(query: $q) { bulkOperation { id status } userErrors { message } } }`,
    { q: BULK_QUERY },
  );
  const op = started.bulkOperationRunQuery;
  if (!op.bulkOperation) throw new Error("Shopify refused the bulk read: " + op.userErrors.map((e) => e.message).join("; "));
  const id = op.bulkOperation.id;

  const deadline = Date.now() + maxWaitMs;
  let url: string | null = null;
  for (;;) {
    await new Promise((r) => setTimeout(r, 2000));
    const p = await gql<PollResult>(`query poll($id: ID!) { node(id: $id) { ... on BulkOperation { status url errorCode objectCount } } }`, { id });
    const n = p.node;
    if (!n) throw new Error("bulk operation disappeared");
    if (n.status === "COMPLETED") { url = n.url; break; }
    if (["FAILED", "CANCELED", "EXPIRED"].includes(n.status)) throw new Error(`bulk read ${n.status.toLowerCase()}${n.errorCode ? ": " + n.errorCode : ""}`);
    if (Date.now() > deadline) throw new Error("bulk read took too long");
  }

  const products = new Map<string, Product>();
  if (url) {
    const text = await (await fetch(url)).text();
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      const row = JSON.parse(line) as Record<string, unknown> & { id: string; __parentId?: string };
      if (row.__parentId) {
        products.get(row.__parentId)?.variants.push(row as unknown as Variant);
      } else {
        products.set(row.id, { ...(row as unknown as Product), variants: [] });
      }
    }
  }
  return { products: [...products.values()], readAt: new Date().toISOString(), bulkOperationId: id };
}
