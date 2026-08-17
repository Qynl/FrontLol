// Compresses every *.bin map file under resources/maps/ to *.bin.gz and
// removes the raw file. The game loaders fetch the .gz and decompress at
// runtime (see src/core/game/Gzip.ts), which keeps the deployable build output
// (and the git repo) small — raw terrain binaries are ~4-8% of their gzipped
// size.
//
// Idempotent: a *.bin that already has a matching *.bin.gz is left alone.
//
// Usage: node scripts/compress-maps.mjs
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync, unlinkSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mapsDir = join(root, "resources", "maps");

function gzipHash(buf) {
  return createHash("sha256").update(buf).digest("hex").slice(0, 12);
}

let compressed = 0;
let skipped = 0;
let totalSaved = 0;

for (const mapName of readdirSync(mapsDir)) {
  const mapDir = join(mapsDir, mapName);
  if (!statSync(mapDir).isDirectory()) continue;

  for (const fileName of readdirSync(mapDir)) {
    if (!fileName.endsWith(".bin")) continue;

    const rawPath = join(mapDir, fileName);
    const gzPath = `${rawPath}.gz`;

    const raw = readFileSync(rawPath);
    const gz = gzipSync(raw, { level: 9 });

    // Skip if the .gz already exists with identical content.
    if (existsSync(gzPath)) {
      const existing = readFileSync(gzPath);
      if (existing.equals(gz)) {
        unlinkSync(rawPath);
        skipped++;
        totalSaved += raw.length - gz.length;
        continue;
      }
    }

    writeFileSync(gzPath, gz);
    unlinkSync(rawPath);

    compressed++;
    totalSaved += raw.length - gz.length;
    console.log(
      `${mapName}/${fileName}: ${(raw.length / 1024 / 1024).toFixed(1)}MB -> ${(gz.length / 1024 / 1024).toFixed(1)}MB`,
    );
  }
}

console.log(
  `\nCompressed ${compressed} files, skipped ${skipped} already-compressed, saved ${(totalSaved / 1024 / 1024).toFixed(0)}MB total.`,
);
