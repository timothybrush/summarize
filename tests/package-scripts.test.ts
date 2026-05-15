import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const rootPackage = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

describe("package scripts", () => {
  it("keeps the root check gate complete", () => {
    expect(rootPackage.scripts.check).toContain("pnpm format:check");
    expect(rootPackage.scripts.check).toContain("pnpm lint");
    expect(rootPackage.scripts.check).toContain("pnpm typecheck");
    expect(rootPackage.scripts.check).toContain("pnpm test:coverage");
  });

  it("keeps the lint script type-aware", () => {
    expect(rootPackage.scripts.lint).toBe(
      "oxlint --type-aware --tsconfig tsconfig.build.json --config .oxlintrc.json .",
    );
  });

  it("builds core before root library and CLI outputs", () => {
    expect(rootPackage.scripts.build).toBe(
      "pnpm clean && pnpm -C packages/core build && pnpm build:lib && pnpm build:cli",
    );
  });

  it("typechecks both workspace layers from the root script", () => {
    expect(rootPackage.scripts.typecheck).toBe(
      "pnpm -C packages/core typecheck && tsgo -p tsconfig.build.json --noEmit",
    );
  });

  it("runs vitest in non-watch mode from the root test script", () => {
    expect(rootPackage.scripts.test).toBe("vitest run");
  });
});
