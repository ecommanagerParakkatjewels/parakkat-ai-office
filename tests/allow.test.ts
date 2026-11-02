import { afterEach, describe, expect, it } from "vitest";
import { isAllowed } from "../src/lib/allow";

const keep = process.env.ALLOWED_EMAILS;
afterEach(() => { process.env.ALLOWED_EMAILS = keep; });

describe("email allowlist", () => {
  it("fails closed when ALLOWED_EMAILS is missing or empty", () => {
    delete process.env.ALLOWED_EMAILS;
    expect(isAllowed("a@b.com")).toBe(false);
    process.env.ALLOWED_EMAILS = " , ";
    expect(isAllowed("a@b.com")).toBe(false);
  });
  it("allows only listed emails, ignoring case and spaces", () => {
    process.env.ALLOWED_EMAILS = "Owner@Example.com, second@example.com";
    expect(isAllowed("owner@example.com")).toBe(true);
    expect(isAllowed(" SECOND@example.com ")).toBe(true);
    expect(isAllowed("intruder@example.com")).toBe(false);
  });
  it("rejects a user with no email", () => {
    process.env.ALLOWED_EMAILS = "owner@example.com";
    expect(isAllowed(undefined)).toBe(false);
    expect(isAllowed("")).toBe(false);
  });
  it("does not match on a substring", () => {
    process.env.ALLOWED_EMAILS = "owner@example.com";
    expect(isAllowed("evilowner@example.com")).toBe(false);
    expect(isAllowed("owner@example.com.evil.net")).toBe(false);
  });
});
