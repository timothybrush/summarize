import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const rootPackage = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

describe("package scripts", () => {
  it("typechecks the core workspace package from the root script", () => {
    expect(rootPackage.scripts.typecheck).toContain("pnpm -C packages/core typecheck");
  });
});
