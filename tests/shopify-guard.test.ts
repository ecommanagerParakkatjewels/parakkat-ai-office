import { describe, it, expect, vi } from "vitest";
process.env.SHOPIFY_STORE = "example";
process.env.SHOPIFY_ADMIN_TOKEN = "test";
const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ data: {} }), { status: 200 }));
vi.stubGlobal("fetch", fetchSpy);
const { gql } = await import("../src/lib/shopify/client");

describe("Shopify client is read-only", () => {
  it("refuses any mutation other than a bulk read, before touching the network", async () => {
    for (const doc of [
      `mutation { productUpdate(input: {id: "x", title: "y"}) { product { id } } }`,
      `mutation m { productDelete(input: {id: "x"}) { deletedProductId } }`,
      `mutation { bulkOperationRunMutation(mutation: "x", stagedUploadPath: "y") { bulkOperation { id } } }`,
      `subscription { x }`,
    ]) await expect(gql(doc)).rejects.toThrow(/refused/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("allows queries and the bulk read", async () => {
    await gql(`query { shop { name } }`);
    await gql(`{ shop { name } }`);
    await gql(`mutation run($q: String!) { bulkOperationRunQuery(query: $q) { bulkOperation { id } } }`, { q: "{ products { edges { node { id } } } }" });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});
