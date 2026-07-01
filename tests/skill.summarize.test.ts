import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildProgram } from "../src/run/help.js";

const skillPath = resolve(".agents/skills/summarize/SKILL.md");

describe("canonical summarize skill", () => {
  it("has routable frontmatter and matching UI metadata", async () => {
    const skill = await readFile(skillPath, "utf8");
    const metadata = await readFile(resolve(dirname(skillPath), "agents/openai.yaml"), "utf8");

    expect(skill).toMatch(
      /^---\nname: summarize\ndescription: "Summarize CLI: URLs, files, YouTube, transcripts, media, extraction, and JSON output\."\n---\n/,
    );
    expect(metadata).toContain('display_name: "Summarize"');
    expect(metadata).toContain("$summarize");
  });

  it("keeps documented core flags aligned with visible CLI help", async () => {
    const skill = await readFile(skillPath, "utf8");
    const help = buildProgram().helpInformation();

    for (const flag of [
      "--cli",
      "--diarize",
      "--extract",
      "--format",
      "--json",
      "--language",
      "--length",
      "--markdown-mode",
      "--metrics",
      "--plain",
      "--prompt-file",
      "--slides",
      "--timestamps",
      "--transcriber",
      "--youtube",
    ]) {
      expect(skill, `skill must document ${flag}`).toContain(flag);
      expect(help, `CLI help must expose ${flag}`).toContain(flag);
    }
  });

  it("links only to existing repository documentation", async () => {
    const skill = await readFile(skillPath, "utf8");
    const links = Array.from(
      skill.matchAll(/\]\((\.\.\/\.\.\/\.\.\/[^)]+\.md)\)/g),
      (match) => match[1],
    );

    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      await expect(access(resolve(dirname(skillPath), link))).resolves.toBeUndefined();
    }
  });
});
