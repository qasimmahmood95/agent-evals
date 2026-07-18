/**
 * Seeded PRNG for the bootstrap. mulberry32: tiny, deterministic across
 * platforms (integer math + Math.fround-free ops), good enough statistical
 * quality for resampling. Never Math.random - a seed appears in every
 * reported CI so results are reproducible.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
