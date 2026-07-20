import react from "@vitejs/plugin-react";
import { readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

const isPagesBuild = process.env.POKER_DUEL_PAGES === "true";

async function removeCatManifests(directory: string): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });

  await Promise.all(
    entries.map(async (entry) => {
      const entryPath = resolve(directory, entry.name);

      if (entry.isDirectory()) {
        await removeCatManifests(entryPath);
        return;
      }

      if (entry.name === "manifest.json" || entry.name === "frames-manifest.json") {
        await rm(entryPath, { force: true });
      }
    }),
  );
}

function pagesReleaseCleanup(): Plugin {
  return {
    name: "poker-duel-pages-release-cleanup",
    apply: "build",
    async closeBundle() {
      if (!isPagesBuild) {
        return;
      }

      const outputRoot = resolve("dist");
      const catAssetsRoot = resolve(outputRoot, "assets/cats/v1");

      await Promise.all([
        rm(resolve(outputRoot, "cat-lab"), { recursive: true, force: true }),
        rm(resolve(catAssetsRoot, "base"), { recursive: true, force: true }),
      ]);
      await removeCatManifests(catAssetsRoot);
    },
  };
}

export default defineConfig({
  // Local development stays at `/`; GitHub Pages is served below `/poker-duel/`.
  base: isPagesBuild ? "/poker-duel/" : "/",
  plugins: [react(), pagesReleaseCleanup()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
