import { mkdir } from "node:fs/promises";

const FILES: Record<string, string> = {
  "config.json": "https://opencode.ai/config.json",
  "tui.json": "https://opencode.ai/tui.json",
  "model-schema.json": "https://models.dev/model-schema.json",
};

const outDir = new URL("../schemas/", import.meta.url);
await mkdir(outDir, { recursive: true });

const manifest = {
  fetchedAt: new Date().toISOString(),
  files: {} as Record<string, { url: string; bytes: number }>,
};

for (const [name, url] of Object.entries(FILES)) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} failed: ${res.status}`);
  const text = await res.text();
  JSON.parse(text);
  await Bun.write(new URL(name, outDir), text);
  manifest.files[name] = { url, bytes: text.length };
  console.log(`vendored ${name} (${text.length} bytes)`);
}

await Bun.write(new URL("manifest.json", outDir), JSON.stringify(manifest, null, 2) + "\n");
console.log("schemas updated");
