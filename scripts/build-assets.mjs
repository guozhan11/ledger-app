import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/app", { recursive: true });

let html = await readFile("index.html", "utf8");
const inlineScripts = [
  ["./app/vendor/react.production.min.js", "app/vendor/react.production.min.js"],
  ["./app/vendor/react-dom.production.min.js", "app/vendor/react-dom.production.min.js"],
  ["./support.js", "support.js"],
];
const bundledScripts = [];

for (const [src, file] of inlineScripts) {
  const tag = `<script src="${src}"></script>`;
  if (!html.includes(tag)) throw new Error(`Missing script tag for ${src}`);
  const source = (await readFile(file, "utf8")).replaceAll("</script", "<\\/script");
  html = html.replace(tag, "");
  bundledScripts.push(`<script>\n${source}\n</script>`);
}

if (!html.includes("</body>")) throw new Error("Missing closing body tag");
html = html.replace("</body>", () => `${bundledScripts.join("\n")}\n</body>`);

await writeFile("dist/index.html", html);
await Promise.all([
  cp("support.js", "dist/support.js"),
  cp("service-worker.js", "dist/service-worker.js"),
  cp("_headers", "dist/_headers"),
  cp("app", "dist/app", { recursive: true }),
]);
