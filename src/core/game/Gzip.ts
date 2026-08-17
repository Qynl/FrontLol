// Decompresses gzip bytes using the platform-native DecompressionStream
// (available in browsers, Web Workers, and Node 18+). Kept dependency-free
// because it lives in src/core. Map binaries are stored gzipped on disk to
// keep the deployable build output small (raw terrain data is ~4-8% of its
// gzipped size).
export async function decompressGzip(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error(
      "DecompressionStream is not supported in this environment; cannot load gzipped map data",
    );
  }

  // Build the source stream manually rather than via Blob.stream(), which is
  // not implemented in some environments (e.g. jsdom in tests). The
  // ReadableStream constructor is supported in browsers, Web Workers, and
  // Node 18+.
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
  // DecompressionStream is typed with a BufferSource writable, which does not
  // line up with ReadableStream<Uint8Array> in the typed-array-generic lib.dom
  // typings; at runtime it accepts Uint8Array input fine.
  const stream = source.pipeThrough(
    new DecompressionStream("gzip") as unknown as ReadableWritablePair<
      Uint8Array,
      Uint8Array
    >,
  );
  const decompressed = await new Response(stream).arrayBuffer();
  return new Uint8Array(decompressed);
}
