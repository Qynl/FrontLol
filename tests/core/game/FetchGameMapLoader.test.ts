import { gzipSync } from "node:zlib";
import { describe, expect, test, vi } from "vitest";
import { FetchGameMapLoader } from "../../../src/core/game/FetchGameMapLoader";
import { GameMapType } from "../../../src/core/game/Game";

describe("FetchGameMapLoader", () => {
  test("resolves each map file through the provided path resolver", async () => {
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(0),
      json: async () => ({ url }),
      statusText: "OK",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const loader = new FetchGameMapLoader(
      (path) => `/_assets/maps/${path}.hashed`,
    );
    const mapData = loader.getMapData(GameMapType.BritanniaClassic);

    expect(mapData.webpPath).toBe(
      "/_assets/maps/britanniaclassic/thumbnail.webp.hashed",
    );

    await mapData.manifest();

    expect(fetchMock).toHaveBeenCalledWith(
      "/_assets/maps/britanniaclassic/manifest.json.hashed",
    );
  });

  test("fetches gzipped map binaries and decompresses them", async () => {
    const original = new Uint8Array([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    ]);
    const gzipped = gzipSync(original);
    const gzipBuffer = gzipped.buffer.slice(
      gzipped.byteOffset,
      gzipped.byteOffset + gzipped.byteLength,
    );

    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      arrayBuffer: async () => gzipBuffer,
      json: async () => ({ url }),
      statusText: "OK",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const loader = new FetchGameMapLoader(
      (path) => `/_assets/maps/${path}.hashed`,
    );
    const mapData = loader.getMapData(GameMapType.BritanniaClassic);

    const data = await mapData.mapBin();

    expect([...data]).toEqual([...original]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/_assets/maps/britanniaclassic/map.bin.gz.hashed",
    );
  });
});
