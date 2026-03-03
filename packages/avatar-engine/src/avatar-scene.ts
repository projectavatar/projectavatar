import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/**
 * Core Three.js scene: camera, lighting, renderer, render loop.
 * Pure Three.js — no React, no VRM-specific logic.
 *
 * Supports dynamic framing: when zoomed out the orbit target centers on
 * the full body (hips); when zoomed in the target shifts up to the face
 * for portrait-style framing.
 */

export interface AvatarSceneOptions {
  /** Show a grid floor (useful for clip previews). Default: false. */
  grid?: boolean;
  /** Grid size (default: 4). */
  gridSize?: number;
  /** Grid divisions (default: 16). */
  gridDivisions?: number;
  /** Enable orbit controls (zoom, rotate, pan). Default: false. */
  orbit?: boolean;
  /** Dev mode — unlocks vertical camera rotation. Default: false. */
  dev?: boolean;

}

const DEFAULT_GRID_SIZE = 4;
const DEFAULT_GRID_DIVISIONS = 16;

/**
 * Distance thresholds for dynamic framing.
 * - At FAR_DISTANCE or beyond → target = body center (hips)
 * - At CLOSE_DISTANCE or closer → target = face/head
 * - Between → smooth lerp
 */
/** Padding (in CSS pixels) around the avatar bounding box. */
const AVATAR_BOUNDS_PADDING_PX = 100;

const FAR_DISTANCE = 4;
const CLOSE_DISTANCE = 2;

// ─── Camera persistence ───────────────────────────────────────────────────────

const CAMERA_STORAGE_KEY = 'project-avatar-camera';
const CAMERA_SAVE_DEBOUNCE = 500; // ms

interface CameraState {
  /** Spherical distance from orbit target (zoom level). */
  distance: number;
  /** Azimuthal angle in radians (horizontal orbit). */
  azimuthal: number;
  /** Polar angle in radians (vertical orbit). */
  polar: number;
}

function loadCameraState(): CameraState | null {
  try {
    const raw = localStorage.getItem(CAMERA_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const { distance, azimuthal, polar } = parsed;
    if (
      typeof distance === 'number' && distance > 0 && Number.isFinite(distance) &&
      typeof azimuthal === 'number' && Number.isFinite(azimuthal) &&
      typeof polar === 'number' && Number.isFinite(polar)
    ) {
      return { distance, azimuthal, polar };
    }
    return null;
  } catch { return null; }
}

function saveCameraState(state: CameraState): void {
  try {
    localStorage.setItem(CAMERA_STORAGE_KEY, JSON.stringify(state));
  } catch { /* localStorage unavailable */ }
}

export class AvatarScene {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly clock: THREE.Clock;

  /** VRM model root — set after model load for external consumers (e.g. hit-testing). */
  private _vrmRoot: THREE.Object3D | null = null;

  // ─── Avatar bounds ──────────────────────────────────────────────────
  private _boundsBbox = new THREE.Box3();
  private _boundsCorners: THREE.Vector3[] = Array.from({ length: 8 }, () => new THREE.Vector3());

  // ─── Performance overlay ────────────────────────────────────────────
  private _perfEnabled = false;
  private _perfOverlay: HTMLDivElement | null = null;
  private _perfFrames = 0;
  private _perfLastTime = 0;
  private _perfFps = 0;
  private _perfDrawCalls = 0;
  private _perfTriangles = 0;

  private controls: OrbitControls | null = null;
  private animationFrameId: number | null = null;
  private backgroundIntervalId: ReturnType<typeof setInterval> | null = null;
  private updateCallbacks: Array<(delta: number) => void> = [];
  private onResizeCallback: ((width: number, height: number) => void) | null = null;
  private cameraSaveTimer: ReturnType<typeof setTimeout> | null = null;
  /** Deferred spherical coords — applied once framing points are set. */
  private savedSpherical: CameraState | null = null;

  /**
   * Optional custom render function — replaces renderer.render() in tick().
   * Used by BloomEffect to render through the EffectComposer instead.
   */
  private customRender: (() => void) | null = null;

  /** Dynamic framing points — set via setFramingPoints() after model load. */
  private bodyCenter = new THREE.Vector3(0, 0, 0);
  private faceCenter = new THREE.Vector3(0, 0.5, 0);
  private framingEnabled = false;

  constructor(canvas: HTMLCanvasElement, options?: AvatarSceneOptions) {
    this.scene = new THREE.Scene();

    // Camera: positioned for upper body framing
    this.camera = new THREE.PerspectiveCamera(
      30,
      canvas.clientWidth / canvas.clientHeight,
      0.1,
      20,
    );
    this.camera.position.set(2.50, 0.2, 4.33);
    this.camera.lookAt(0, 0, 0);

    // Renderer: transparent background for OBS/overlay use
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      
      antialias: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    

    // Three-point lighting
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
    keyLight.position.set(1, 2, 2);
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xb4c6e7, 0.4);
    fillLight.position.set(-1, 1, 1);
    this.scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xffffff, 0.3);
    rimLight.position.set(0, 1, -2);
    this.scene.add(rimLight);

    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambient);

    // Optional grid floor
    if (options?.grid) {
      const grid = new THREE.GridHelper(
        options.gridSize ?? DEFAULT_GRID_SIZE,
        options.gridDivisions ?? DEFAULT_GRID_DIVISIONS,
        0x2a2a3a,
        0x1a1a2a,
      );
      grid.position.y = 0;
      this.scene.add(grid);
    }

    // Optional orbit controls (mouse rotate + zoom)
    if (options?.orbit) {
      this.controls = new OrbitControls(this.camera, canvas);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.08;
      this.controls.target.set(0, 0, 0);
      this.controls.minDistance = 1;
      this.controls.maxDistance = 15;
      const mouseButtons: Record<string, THREE.MOUSE> = {
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.ROTATE,
      };
      // Left-click reserved for future interactions (selection, drag)
      this.controls.mouseButtons = mouseButtons;
      // No panning — orbit target must stay on the model
      this.controls.enablePan = false;
      // Lock vertical rotation in production — no peeking allowed
      if (!options?.dev) {
        // Clamp polar angle to ±22° from equator
        this.controls.minPolarAngle = Math.PI / 2 - 0.38;  // ~68° (±22°)
        this.controls.maxPolarAngle = Math.PI / 2 + 0.38;  // ~112° (±22°)
      }

      this.controls.update();

      // Restore saved camera angle/zoom (spherical coordinates).
      // The orbit target is set by dynamic framing after model load —
      // we only persist the viewer's angle and distance, not position.
      const saved = loadCameraState();
      if (saved) {
        this.savedSpherical = saved;
      }

      // Persist camera on change (debounced)
      this.controls.addEventListener('change', () => {
        if (this.cameraSaveTimer) clearTimeout(this.cameraSaveTimer);
        this.cameraSaveTimer = setTimeout(() => {
          saveCameraState({
            distance: this.controls!.getDistance(),
            azimuthal: this.controls!.getAzimuthalAngle(),
            polar: this.controls!.getPolarAngle(),
          });
          this.cameraSaveTimer = null;
        }, CAMERA_SAVE_DEBOUNCE);
      });

      // Flush pending camera save on tab close / navigation
      this.handleBeforeUnload = this.handleBeforeUnload.bind(this);
      window.addEventListener('beforeunload', this.handleBeforeUnload);
    }

    this.clock = new THREE.Clock();

    // Handle window resize
    this.handleResize = this.handleResize.bind(this);
    window.addEventListener('resize', this.handleResize);

    // Handle background tab throttling
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

  /**
   * Set the two framing anchor points for dynamic zoom-based targeting.
   * @param body — orbit target when zoomed out (typically hips/body center)
   * @param face — orbit target when zoomed in (typically head/face)
   */
  setFramingPoints(body: THREE.Vector3, face: THREE.Vector3): void {
    this.bodyCenter.copy(body);
    this.faceCenter.copy(face);
    this.framingEnabled = true;
    this._updateFramingTarget();

    // Apply deferred spherical coords now that the orbit target is valid.
    // We position the camera relative to the freshly-computed target.
    if (this.savedSpherical && this.controls) {
      const { distance, azimuthal, polar } = this.savedSpherical;
      const target = this.controls.target;
      const offset = new THREE.Vector3();
      // Three.js setFromSphericalCoords(radius, phi, theta) —
      // phi = polar angle from Y+, theta = azimuthal angle from Z+ in XZ plane
      offset.setFromSphericalCoords(distance, polar, azimuthal);
      this.camera.position.copy(target).add(offset);
      this.controls.update();
      this.savedSpherical = null;
    }
  }

  /** Register an update callback invoked each frame with delta time. */
  onUpdate(callback: (delta: number) => void): void {
    this.updateCallbacks.push(callback);
  }

  /** Remove a previously registered update callback. */
  removeUpdate(callback: (delta: number) => void): void {
    const idx = this.updateCallbacks.indexOf(callback);
    if (idx !== -1) this.updateCallbacks.splice(idx, 1);
  }

  /**
   * Set a custom render function that replaces renderer.render().
   * Pass null to restore default rendering.
   */
  setCustomRender(fn: (() => void) | null): void {
    this.customRender = fn;
  }

  /** Start the render loop. */
  start(): void {
    if (this.animationFrameId !== null) return;
    this.clock.start();
    this.loop();
  }

  /** Stop the render loop and clean up. */
  stop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.stopBackgroundRenderer();
  }

  /** Get the VRM model root (set via setVrmRoot after model load). */
  get vrmRoot(): THREE.Object3D | null {
    return this._vrmRoot;
  }

  /** Set the VRM model root for external consumers. */
  setVrmRoot(root: THREE.Object3D | null): void {
    this._vrmRoot = root;
  }

  /** Full cleanup — call when unmounting. */
  dispose(): void {
    this.stop();
    if (this.cameraSaveTimer) clearTimeout(this.cameraSaveTimer);
    this.controls?.dispose();
    window.removeEventListener('beforeunload', this.handleBeforeUnload);
    window.removeEventListener('resize', this.handleResize);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.renderer.dispose();
    this.updateCallbacks.length = 0;
    this._perfOverlay?.remove();
    this._perfOverlay = null;
  }

  // ─── Dynamic framing ───────────────────────────────────────────────

  /**
   * Lerp the orbit target between bodyCenter and faceCenter based on
   * camera distance. Called every frame in tick().
   */
  private _updateFramingTarget(): void {
    if (!this.framingEnabled || !this.controls) return;

    const dist = this.camera.position.distanceTo(this.bodyCenter);

    // Compute t: 0 = far (body), 1 = close (face)
    const t = THREE.MathUtils.clamp(
      1 - (dist - CLOSE_DISTANCE) / (FAR_DISTANCE - CLOSE_DISTANCE),
      0,
      1,
    );

    // Smooth ease (smoothstep)
    const tSmooth = t * t * (3 - 2 * t);

    this.controls.target.lerpVectors(this.bodyCenter, this.faceCenter, tSmooth);
  }

  // ─── Private ────────────────────────────────────────────────────────

  private loop = (): void => {
    this.animationFrameId = requestAnimationFrame(this.loop);
    this.tick();
  };

  private tick(): void {
    const delta = this.clock.getDelta();
    // Check for container resize every frame (handles layout changes, not just window resize)
    this.handleResize();
    this._updateFramingTarget();
    this.controls?.update();
    for (const cb of this.updateCallbacks) {
      cb(delta);
    }
    if (this._perfEnabled) {
      this.renderer.info.autoReset = false;
      this.renderer.info.reset();
    }

    if (this.customRender) {
      this.customRender();
    } else {
      this.renderer.render(this.scene, this.camera);
    }

    if (this._perfEnabled) {
      this._perfDrawCalls = this.renderer.info.render.calls;
      this._perfTriangles = this.renderer.info.render.triangles;
      this.renderer.info.autoReset = true;
    }

    this._updatePerfOverlay();
  }

  // ─── Performance debug overlay ──────────────────────────────────────

  /** Toggle performance debug overlay (Shift+P). Shows FPS, window size, draw calls. */
  setPerfOverlay(enabled: boolean): void {
    this._perfEnabled = enabled;
    if (enabled && !this._perfOverlay) {
      document.body.style.outline = '2px solid rgba(0, 255, 0, 0.5)';
      document.body.style.outlineOffset = '-2px';
      const div = document.createElement('div');
      div.id = 'avatar-perf-overlay';
      div.style.cssText = `
        position: fixed; top: 8px; left: 8px; z-index: 99999;
        background: rgba(0,0,0,0.85); color: #0f0; font: 11px/1.5 monospace;
        padding: 6px 10px; border-radius: 4px; pointer-events: none;
        white-space: pre; min-width: 220px;
      `;
      document.body.appendChild(div);
      this._perfOverlay = div;
      this._perfLastTime = performance.now();
      this._perfFrames = 0;
    } else if (!enabled && this._perfOverlay) {
      this._perfOverlay.remove();
      this._perfOverlay = null;
      document.body.style.outline = '';
      document.body.style.outlineOffset = '';
    }
  }

  get perfOverlayEnabled(): boolean { return this._perfEnabled; }

  private _updatePerfOverlay(): void {
    if (!this._perfOverlay) return;

    this._perfFrames++;
    const now = performance.now();
    const elapsed = now - this._perfLastTime;
    if (elapsed >= 500) {
      this._perfFps = Math.round((this._perfFrames / elapsed) * 1000);
      this._perfFrames = 0;
      this._perfLastTime = now;
    }

    const info = this.renderer.info;
    const canvas = this.renderer.domElement;
    const bounds = this.getAvatarBounds();
    const boundsLine = bounds ? 'avatar: ' + bounds.width + '\u00d7' + bounds.height : 'avatar: loading';
    const mem = info.memory;
    const lines = [
      'fps: ' + this._perfFps,
      'window: ' + canvas.width + '\u00d7' + canvas.height,
      boundsLine,
      'draws: ' + this._perfDrawCalls + '  tris: ' + this._perfTriangles,
      'textures: ' + mem.textures + '  geometries: ' + mem.geometries,
    ].join('\n');
    this._perfOverlay.textContent = lines;
  }

  // ─── Avatar bounds ────────────────────────────────────────────────────

  /** Compute the avatar's projected screen bounds in CSS pixels. */
  /**
   * Compute the avatar's projected screen bounds in CSS pixels.
   * Uses NDC span only (window-independent) to avoid feedback loops
   * where resize → new bounds → resize again.
   *
   * Returns the pixel size needed for a square window to fully contain
   * the avatar at the current camera zoom, based on devicePixelRatio.
   */
  getAvatarBounds(): { width: number; height: number; ndcW: number; ndcH: number } | null {
    if (!this._vrmRoot) return null;

    this._boundsBbox.setFromObject(this._vrmRoot);
    if (this._boundsBbox.isEmpty()) return null;

    const { min, max } = this._boundsBbox;
    const corners = this._boundsCorners;
    corners[0]!.set(min.x, min.y, min.z);
    corners[1]!.set(min.x, min.y, max.z);
    corners[2]!.set(min.x, max.y, min.z);
    corners[3]!.set(min.x, max.y, max.z);
    corners[4]!.set(max.x, min.y, min.z);
    corners[5]!.set(max.x, min.y, max.z);
    corners[6]!.set(max.x, max.y, min.z);
    corners[7]!.set(max.x, max.y, max.z);

    let ndcMinX = Infinity, ndcMinY = Infinity;
    let ndcMaxX = -Infinity, ndcMaxY = -Infinity;

    for (const c of corners) {
      c.project(this.camera);
      ndcMinX = Math.min(ndcMinX, c.x);
      ndcMinY = Math.min(ndcMinY, c.y);
      ndcMaxX = Math.max(ndcMaxX, c.x);
      ndcMaxY = Math.max(ndcMaxY, c.y);
    }

    // NDC span (0..2 range). These are window-size-independent.
    const ndcW = ndcMaxX - ndcMinX;
    const ndcH = ndcMaxY - ndcMinY;

    // For perf overlay / info: convert to current canvas CSS pixels
    const canvas = this.renderer.domElement;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    const pad = AVATAR_BOUNDS_PADDING_PX;
    const projW = (ndcW / 2) * cssW + pad * 2;
    const projH = (ndcH / 2) * cssH + pad * 2;

    return { width: Math.ceil(projW), height: Math.ceil(projH), ndcW, ndcH };
  }

  /** Set a resize callback for external compositors. */
  onResize(fn: ((width: number, height: number) => void) | null): void {
    this.onResizeCallback = fn;
  }

  private handleBeforeUnload(): void {
    if (this.controls && this.cameraSaveTimer) {
      clearTimeout(this.cameraSaveTimer);
      this.cameraSaveTimer = null;
      saveCameraState({
        distance: this.controls.getDistance(),
        azimuthal: this.controls.getAzimuthalAngle(),
        polar: this.controls.getPolarAngle(),
      });
    }
  }

  private handleResize(): void {
    const canvas = this.renderer.domElement;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== width || canvas.height !== height) {
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.onResizeCallback?.(width, height);
    }
  }

  private handleVisibilityChange(): void {
    if (document.hidden) {
      if (this.animationFrameId !== null) {
        cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
      }
      this.startBackgroundRenderer();
    } else {
      this.stopBackgroundRenderer();
      if (this.animationFrameId === null) {
        this.loop();
      }
    }
  }

  private startBackgroundRenderer(): void {
    if (this.backgroundIntervalId !== null) return;
    this.backgroundIntervalId = setInterval(() => this.tick(), 100);
  }

  private stopBackgroundRenderer(): void {
    if (this.backgroundIntervalId !== null) {
      clearInterval(this.backgroundIntervalId);
      this.backgroundIntervalId = null;
    }
  }
}
