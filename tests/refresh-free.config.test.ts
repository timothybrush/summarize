import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveRefreshFreeConfigPath, writeFreeModelConfig } from "../src/refresh-free/config.js";

describe("refresh-free config", () => {
  it("resolves the summarize config under HOME", () => {
    expect(resolveRefreshFreeConfigPath({ HOME: "/tmp/example" })).toBe(
      "/tmp/example/.summarize/config.json",
    );
  });

  it("atomically creates and merges the free preset", async () => {
    const home = await mkdtemp(join(tmpdir(), "summarize-refresh-config-"));
    const configDir = join(home, ".summarize");
    const configPath = join(configDir, "config.json");
    await mkdir(configDir);
    await writeFile(
      configPath,
      JSON.stringify({ model: "existing", models: { custom: { model: "provider/model" } } }),
    );

    expect(
      await writeFreeModelConfig({
        env: { HOME: home },
        candidates: ["openrouter/vendor/model:free"],
        setDefault: false,
      }),
    ).toBe(configPath);

    expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual({
      model: "existing",
      models: {
        custom: { model: "provider/model" },
        free: { rules: [{ candidates: ["openrouter/vendor/model:free"] }] },
      },
    });
    expect((await stat(configDir)).mode & 0o777).toBe(0o700);
    expect((await stat(configPath)).mode & 0o777).toBe(0o600);
  });

  it("sets the default model when requested", async () => {
    const home = await mkdtemp(join(tmpdir(), "summarize-refresh-config-"));
    const configPath = await writeFreeModelConfig({
      env: { HOME: home },
      candidates: [],
      setDefault: true,
    });

    expect(JSON.parse(await readFile(configPath, "utf8"))).toMatchObject({
      model: "free",
      models: { free: { rules: [{ candidates: [] }] } },
    });
  });

  it("rejects comments and invalid object shapes", async () => {
    const home = await mkdtemp(join(tmpdir(), "summarize-refresh-config-"));
    const configDir = join(home, ".summarize");
    const configPath = join(configDir, "config.json");
    await mkdir(configDir);

    await writeFile(configPath, "{\n// comment\n}\n");
    await expect(
      writeFreeModelConfig({ env: { HOME: home }, candidates: [], setDefault: false }),
    ).rejects.toThrow(/comments are not allowed/);

    await writeFile(configPath, "[]\n");
    await expect(
      writeFreeModelConfig({ env: { HOME: home }, candidates: [], setDefault: false }),
    ).rejects.toThrow(/expected an object at the top level/);

    await writeFile(configPath, '{"models":"invalid"}\n');
    await expect(
      writeFreeModelConfig({ env: { HOME: home }, candidates: [], setDefault: false }),
    ).rejects.toThrow(/"models" must be an object/);
  });
});
