// heic-decode ships no types. Only the default export is used (src/main/heicWorker.ts).
declare module 'heic-decode' {
  interface Decoded {
    width: number;
    height: number;
    /** RGBA, 8 bits per channel. */
    data: Uint8ClampedArray;
  }
  function decode(opts: { buffer: ArrayBufferLike | Uint8Array }): Promise<Decoded>;
  export default decode;
}

// electron-vite bundles a module imported with ?modulePath on its own and gives its built path.
declare module '*?modulePath' {
  const path: string;
  export default path;
}
