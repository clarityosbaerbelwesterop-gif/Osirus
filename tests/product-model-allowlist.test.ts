import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRODUCT_MODEL_ID,
  PRODUCT_MODEL_ALLOWLIST,
} from "../src/config/recommendations";
import {
  isAllowedProductModel,
  productModelOrDefault,
} from "../src/lib/models/allowlist";
import { catalogModel } from "../src/lib/models/catalog";

describe("product model allowlist", () => {
  it("uses catalog ids only, with the default on the list", () => {
    expect(PRODUCT_MODEL_ALLOWLIST.length).toBeGreaterThan(0);
    expect(isAllowedProductModel(DEFAULT_PRODUCT_MODEL_ID)).toBe(true);
    for (const id of PRODUCT_MODEL_ALLOWLIST) {
      const row = catalogModel(id);
      expect(row, id).not.toBeNull();
      expect(row?.online, id).toBe(true);
      expect(row?.chat, id).toBe(true);
      expect(isAllowedProductModel(id)).toBe(true);
    }
  });

  it("rejects retired program names and ids that are not on the list", () => {
    for (const id of ["rouge", "quasnir", "darus", "ROUGE 1", "not-a-model"]) {
      expect(isAllowedProductModel(id)).toBe(false);
      expect(productModelOrDefault(id)).toBe(DEFAULT_PRODUCT_MODEL_ID);
    }
    expect(productModelOrDefault(null)).toBe(DEFAULT_PRODUCT_MODEL_ID);
    expect(productModelOrDefault(DEFAULT_PRODUCT_MODEL_ID)).toBe(
      DEFAULT_PRODUCT_MODEL_ID,
    );
  });

  it("is what chat turns and the product surfaces validate against", () => {
    const turns = readFileSync(
      join(process.cwd(), "src/app/api/chat/turns/route.ts"),
      "utf8",
    );
    const hub = readFileSync(
      join(process.cwd(), "src/components/chat/chat-hub.tsx"),
      "utf8",
    );
    const coding = readFileSync(
      join(process.cwd(), "src/components/coding/coding-surface.tsx"),
      "utf8",
    );
    expect(turns).toContain("isAllowedProductModel");
    expect(turns).not.toContain('z.enum(["rouge"');
    expect(hub).toContain("DEFAULT_PRODUCT_MODEL_ID");
    expect(hub).not.toContain('return "rouge"');
    expect(coding).toContain("PRODUCT_MODEL_ALLOWLIST");
    expect(coding).not.toContain('"rouge"');
  });
});
