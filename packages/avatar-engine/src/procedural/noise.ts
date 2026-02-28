/**
 * Simplex-inspired noise for organic animation drift.
 *
 * This is a lightweight 1D noise function — not full Perlin/simplex,
 * but good enough for subtle bone drift. Uses a hash-based smooth
 * noise with cubic interpolation.
 *
 * We avoid pulling in a full noise library for ~30 lines of math.
 */

// Permutation table (256 entries, doubled to avoid wrapping)
const PERM = new Uint8Array(512);
{
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  // Fisher-Yates shuffle with fixed seed for determinism
  let seed = 42;
  for (let i = 255; i > 0; i--) {
    seed = (seed * 16807 + 0) % 2147483647;
    const j = seed % (i + 1);
    [p[i], p[j]] = [p[j]!, p[i]!];
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255]!;
}

/** Fade curve: 6t^5 - 15t^4 + 10t^3 (improved Perlin fade). */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Linear interpolation. */
function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

/** Hash-based gradient at integer position. Returns [-1, 1]. */
function grad(hash: number): number {
  return ((hash & 0xff) / 127.5) - 1;
}

/**
 * 1D smooth noise. Returns a value in approximately [-1, 1].
 *
 * @param x     Input coordinate
 * @param seed  Offset to create independent noise channels
 */
export function noise1D(x: number, seed: number = 0): number {
  const offsetX = x + seed * 137.7;
  const xi = Math.floor(offsetX);
  const xf = offsetX - xi;

  const t = fade(xf);

  const a = grad(PERM[(xi & 255)]!);
  const b = grad(PERM[((xi + 1) & 255)]!);

  return lerp(a, b, t);
}
