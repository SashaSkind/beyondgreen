// Assemble the public site: the presentation plus the investigation viewer.
//
// The viewer is written for the local server, which transpiles model.ts on the
// fly and serves assets from the root. A static host does neither, so this
// transpiles once and rewrites those root-relative references to relative ones.
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { stripTypeScriptTypes } from "node:module";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { out: { type: "string", default: "_site" } } });
const out = resolve(values.out);
const viewer = join(out, "viewer");

await rm(out, { recursive: true, force: true });
await mkdir(viewer, { recursive: true });

await cp("site/index.html", join(out, "index.html"));
for (const file of ["app.js", "styles.css", "demo.json", "index.html"]) {
  await cp(join("ui", file), join(viewer, file));
}
await cp("ui/fonts", join(viewer, "fonts"), { recursive: true });
await writeFile(join(viewer, "model.js"), stripTypeScriptTypes(await readFile("src/viewer/model.ts", "utf8")));

async function rewrite(file: string, edits: [RegExp, string][]) {
  const path = join(viewer, file);
  let text = await readFile(path, "utf8");
  for (const [pattern, replacement] of edits) {
    if (!pattern.test(text)) throw new Error(`Expected ${pattern} in viewer/${file}; the viewer changed shape`);
    text = text.replace(pattern, replacement);
  }
  await writeFile(path, text);
}

await rewrite("app.js", [
  [/from "\/model\.js"/, 'from "./model.js"'],
  [/fetch\("\/demo\.json"\)/, 'fetch("./demo.json")'],
]);
await rewrite("index.html", [
  [/href="\/styles\.css"/, 'href="styles.css"'],
  [/src="\/app\.js"/, 'src="app.js"'],
  [/href="\/fonts\//g, 'href="fonts/'],
  [/href="\/" aria-label/, 'href="../index.html" aria-label'],
]);

console.log(`Built ${out} with the presentation and the viewer.`);
