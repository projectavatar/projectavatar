/**
 * AssetResolver — resolves asset paths to URLs, with optional caching.
 *
 * Web: assets are relative paths ("/models/maid.vrm" → fetched from same origin).
 * Desktop: assets are fetched from a remote base URL, then cached locally.
 *
 * The resolver supports a pluggable cache backend (e.g. Tauri FS, IndexedDB,
 * or in-memory) via the AssetCache interface.
 *
 * Usage:
 *   const resolver = new AssetResolver({ baseUrl: 'https://app.projectavatar.io' });
 *   const url = await resolver.resolve('/models/maid.vrm');
 *   // → returns blob URL from cache, or fetches from remote + caches
 */

// ─── Cache interface ──────────────────────────────────────────────────────────

/** Pluggable cache backend for storing fetched assets as binary data. */
export interface AssetCache {
  /** Check if an asset exists in cache. */
  has(key: string): Promise<boolean>;
  /** Read cached asset as ArrayBuffer. Returns null if not cached. */
  get(key: string): Promise<ArrayBuffer | null>;
  /** Store an asset in cache. */
  set(key: string, data: ArrayBuffer): Promise<void>;
  /** Remove a cached asset. */
  delete(key: string): Promise<void>;
  /** Clear all cached assets. */
  clear(): Promise<void>;
}

// ─── Config ───────────────────────────────────────────────────────────────────

export interface AssetResolverOptions {
  /**
   * Base URL prefix for remote assets.
   * - Empty string or undefined = relative paths (web, same-origin)
   * - "https://app.projectavatar.io" = fetch from remote (desktop)
   */
  baseUrl?: string;

  /**
   * Optional cache backend. When provided, fetched remote assets are
   * cached locally and served from cache on subsequent loads.
   */
  cache?: AssetCache;
}

// ─── Resolver ─────────────────────────────────────────────────────────────────

export class AssetResolver {
  private baseUrl: string;
  private cache: AssetCache | null;

  /** In-flight fetches keyed by asset path — prevents duplicate requests. */
  private inflight = new Map<string, Promise<string>>();

  /** Active blob URLs that need revoking on dispose. */
  private blobUrls = new Set<string>();

  constructor(options: AssetResolverOptions = {}) {
    // Normalize: strip trailing slash
    this.baseUrl = (options.baseUrl ?? '').replace(/\/$/, '');
    this.cache = options.cache ?? null;
  }

  /** Whether this resolver fetches from a remote base URL. */
  get isRemote(): boolean {
    return this.baseUrl.length > 0;
  }

  /**
   * Resolve an asset path to a usable URL.
   *
   * - If no baseUrl (web): returns the path as-is (same-origin relative).
   * - If baseUrl + no cache: returns the full remote URL.
   * - If baseUrl + cache: returns a blob URL from cache (fetching + caching first if needed).
   *
   * @param path Asset path, e.g. "/models/maid.vrm" or "/animations/idle.fbx"
   */
  async resolve(path: string): Promise<string> {
    // Web mode: same-origin, return path as-is
    if (!this.isRemote) {
      return path;
    }

    const fullUrl = this.baseUrl + path;

    // Remote, no cache: return the full URL directly
    if (!this.cache) {
      return fullUrl;
    }

    // Remote + cache: check cache, fetch if missing
    // Deduplicate in-flight requests for the same path
    const existing = this.inflight.get(path);
    if (existing) return existing;

    const promise = this._resolveWithCache(path, fullUrl);
    this.inflight.set(path, promise);

    try {
      return await promise;
    } finally {
      this.inflight.delete(path);
    }
  }

  /**
   * Prefetch and cache a list of asset paths in parallel.
   * Useful for preloading all animations/models on startup.
   */
  async prefetch(paths: string[]): Promise<void> {
    if (!this.isRemote || !this.cache) return;
    await Promise.allSettled(paths.map((p) => this.resolve(p)));
  }

  /** Revoke all blob URLs and clear references. */
  dispose(): void {
    for (const url of this.blobUrls) {
      URL.revokeObjectURL(url);
    }
    this.blobUrls.clear();
    this.inflight.clear();
  }

  // ─── Private ──────────────────────────────────────────────────────────

  private async _resolveWithCache(path: string, fullUrl: string): Promise<string> {
    const cache = this.cache!;

    // Try cache first
    const cached = await cache.get(path);
    if (cached) {
      const blob = new Blob([cached]);
      const blobUrl = URL.createObjectURL(blob);
      this.blobUrls.add(blobUrl);
      return blobUrl;
    }

    // Fetch from remote
    const response = await fetch(fullUrl);
    if (!response.ok) {
      throw new Error(`[AssetResolver] Failed to fetch ${fullUrl}: ${response.status} ${response.statusText}`);
    }

    const data = await response.arrayBuffer();

    // Store in cache (don't await — fire-and-forget is fine here)
    cache.set(path, data).catch((err) => {
      console.warn(`[AssetResolver] Cache write failed for ${path}:`, err);
    });

    // Return as blob URL
    const blob = new Blob([data]);
    const blobUrl = URL.createObjectURL(blob);
    this.blobUrls.add(blobUrl);
    return blobUrl;
  }
}
