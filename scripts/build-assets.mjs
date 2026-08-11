import { cp, mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/app", { recursive: true });
await Promise.all([
  cp("index.html", "dist/index.html"),
  cp("support.js", "dist/support.js"),
  cp("service-worker.js", "dist/service-worker.js"),
  cp("_headers", "dist/_headers"),
  cp("app", "dist/app", { recursive: true }),
]);
