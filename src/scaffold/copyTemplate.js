import fs from "node:fs/promises";
import path from "node:path";

import { substituteTokens } from "./tokens.js";

/**
 * Refuse to scaffold into a non-empty directory unless `force` is set. Never
 * deletes anything — `force` only lifts the refusal, it does not clear the
 * directory first, so pre-existing unrelated files are left alone and
 * template files land on top of (overwrite) any same-named files.
 */
export async function ensureWritableOutputDir(outDir, force) {
  let entries;
  try {
    entries = await fs.readdir(outDir);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  if (entries.length > 0 && !force) {
    throw new Error(
      `Refusing to scaffold into non-empty directory ${outDir} ` +
        `(${entries.length} existing ${entries.length === 1 ? "entry" : "entries"}). ` +
        `Pass --force to scaffold into it anyway.`,
    );
  }
}

/**
 * Copy every file under `templateDir` into `outDir`, applying token
 * substitution to BOTH file contents and file/directory names. Every
 * template file is treated as UTF-8 text — correct for this SDK's templates
 * (JSON/JS/C/C++/Markdown), and deliberate: a template that ever needs a
 * binary asset is a signal to reconsider, not something this copier should
 * silently support.
 *
 * Returns the sorted list of output-relative (posix-style) file paths that
 * were written.
 */
export async function copyTemplateTree(templateDir, outDir, tokens) {
  const created = [];

  async function walk(currentTemplateDir, currentOutDir) {
    const entries = await fs.readdir(currentTemplateDir, {
      withFileTypes: true,
    });
    for (const entry of entries) {
      const destName = substituteTokens(entry.name, tokens);
      const srcPath = path.join(currentTemplateDir, entry.name);
      const destPath = path.join(currentOutDir, destName);
      if (entry.isDirectory()) {
        await fs.mkdir(destPath, { recursive: true });
        await walk(srcPath, destPath);
      } else if (entry.isFile()) {
        await fs.mkdir(path.dirname(destPath), { recursive: true });
        const raw = await fs.readFile(srcPath, "utf8");
        await fs.writeFile(destPath, substituteTokens(raw, tokens), "utf8");
        created.push(
          path.relative(outDir, destPath).split(path.sep).join("/"),
        );
      }
    }
  }

  await fs.mkdir(outDir, { recursive: true });
  await walk(templateDir, outDir);
  created.sort();
  return created;
}
