import { describe, expect, it } from "vitest";
import { createVitestConfig, resolveMaxThreads } from "../vitest.config.js";

describe("vitest config", () => {
  it("uses positive integer thread overrides", () => {
    expect(resolveMaxThreads("1", 16)).toBe(1);
    expect(resolveMaxThreads(" 3 ", 16)).toBe(3);
  });

  it.each(["", "0", "-1", "1.5", "1e2", "0x10", "2 threads", "999999999999999999999"])(
    "ignores invalid VITEST_MAX_THREADS=%j",
    (raw) => {
      expect(resolveMaxThreads(raw, 16)).toBe(8);
    },
  );

  it("wires VITEST_MAX_THREADS into Vitest 4 maxWorkers", () => {
    const config = createVitestConfig({
      env: { VITEST_MAX_THREADS: "1" },
      availableCpus: 16,
    });

    expect(config.test?.maxWorkers).toBe(1);
    expect("poolOptions" in config).toBe(false);
  });
});
