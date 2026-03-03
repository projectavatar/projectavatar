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
/** Padding (in CSS pixels) around the avatar bounding box for the scissor rect. */
const SCISSOR_PADDING_PX = 250;

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
  /** View offset in pixels (pan). */
  panX?: number;
  panY?: number;
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
      const state: CameraState = { distance, azimuthal, polar };
      if (typeof parsed.panX === 'number' && Number.isFinite(parsed.panX)) state.panX = parsed.panX;
      if (typeof parsed.panY === 'number' && Number.isFinite(parsed.panY)) state.panY = parsed.panY;
      return state;
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

  // ─── Scissor rendering ──────────────────────────────────────────────
  private _scissorEnabled = false;
  private _scissorBbox = new THREE.Box3();
  private _scissorCorners: THREE.Vector3[] = Array.from({ length: 8 }, () => new THREE.Vector3());
  private _scissorClearColor = new THREE.Color(0x000000);

  private controls: OrbitControls | null = null;
  private animationFrameId: number | null = null;
  private backgroundIntervalId: ReturnType<typeof setInterval> | null = null;
  private updateCallbacks: Array<(delta: number) => void> = [];
  private onResizeCallback: ((width: number, height: number) => void) | null = null;
  private cameraSaveTimer: ReturnType<typeof setTimeout> | null = null;
  /** Deferred spherical coords — applied once framing points are set. */
  private savedSpherical: CameraState | null = null;

  // ─── View-offset pan ────────────────────────────────────────────────
  private _panOffsetX = 0; // pixels
  private _panOffsetY = 0; // pixels

  private _panPointer: { id: number; x: number; y: number } | null = null;

  // Bound handlers
  private _onPanDown: (e: PointerEvent) => void = () => {};
  private _onPanMove: (e: PointerEvent) => void = () => {};
  private _onPanUp: (e: PointerEvent) => void = () => {};

  /**
   * Optional custom render function — replaces renderer.render() in tick().
   * Used by BloomEffect to render through the EffectComposer instead.
   * Receives the active scissor rect (null when scissor is disabled).
   */
  private customRender: ((scissorRect: { x: number; y: number; w: number; h: number; fullW: number; fullH: number } | null) => void) | null = null;

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
    // autoClear disabled when scissor is active — we clear only the scissor region
    // to avoid clearing millions of empty pixels on multi-monitor setups.
    

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
        MIDDLE: -1 as THREE.MOUSE, // reserved for pan
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

      // ── Pan via setViewOffset (left/middle drag) ──
      this._onPanDown = (e: PointerEvent) => {
        if (e.pointerType === 'touch') return; // touch reserved for OrbitControls
        if (e.button !== 0 && e.button !== 1) return;
        if (this._panPointer) return;
        e.preventDefault();
        e.stopImmediatePropagation(); // block OrbitControls
        this._panPointer = { id: e.pointerId, x: e.clientX, y: e.clientY };
        canvas.setPointerCapture(e.pointerId);
        canvas.addEventListener('pointermove', this._onPanMove);
        canvas.addEventListener('pointerup', this._onPanUp);
        canvas.addEventListener('pointercancel', this._onPanUp);
      };
      this._onPanMove = (e: PointerEvent) => {
        if (!this._panPointer || e.pointerId !== this._panPointer.id) return;
        const dx = e.clientX - this._panPointer.x;
        const dy = e.clientY - this._panPointer.y;
        this._panPointer.x = e.clientX;
        this._panPointer.y = e.clientY;
        const dpr = this.renderer.getPixelRatio();
        this._panOffsetX -= dx * dpr;
        this._panOffsetY -= dy * dpr;
        this._applyViewOffset();
      };
      this._onPanUp = (e: PointerEvent) => {
        if (!this._panPointer || e.pointerId !== this._panPointer.id) return;
        canvas.releasePointerCapture(e.pointerId);
        canvas.removeEventListener('pointermove', this._onPanMove);
        canvas.removeEventListener('pointerup', this._onPanUp);
        canvas.removeEventListener('pointercancel', this._onPanUp);
        this._panPointer = null;
        this._schedulePanSave();
      };
      // Pan handler blocks left/middle from reaching OrbitControls via
      // stopImmediatePropagation. OrbitControls ignores LEFT (not in mouseButtons)
      // but MIDDLE needs explicit blocking here.
      canvas.addEventListener('pointerdown', this._onPanDown);

      // Restore saved camera angle/zoom (spherical coordinates).
      // The orbit target is set by dynamic framing after model load —
      // we only persist the viewer's angle and distance, not position.
      const saved = loadCameraState();
      if (saved) {
        this.savedSpherical = saved;
        if (typeof saved.panX === 'number') this._panOffsetX = saved.panX;
        if (typeof saved.panY === 'number') this._panOffsetY = saved.panY;
        this._applyViewOffset();
      }

      // Persist camera on change (debounced)
      this.controls.addEventListener('change', () => {
        this._schedulePanSave();
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

    // Reapply view offset after controls.update() (it resets the projection)
    if (this._panOffsetX !== 0 || this._panOffsetY !== 0) {
      this._applyViewOffset();
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
   * The function receives the active scissor rect for multi-monitor rendering.
   */
  setCustomRender(fn: ((scissorRect: { x: number; y: number; w: number; h: number; fullW: number; fullH: number } | null) => void) | null): void {
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
    const cvs = this.renderer.domElement;
    cvs.removeEventListener('pointerdown', this._onPanDown);
    cvs.removeEventListener('pointermove', this._onPanMove);
    cvs.removeEventListener('pointerup', this._onPanUp);
    cvs.removeEventListener('pointercancel', this._onPanUp);
    this.controls?.dispose();
    window.removeEventListener('beforeunload', this.handleBeforeUnload);
    window.removeEventListener('resize', this.handleResize);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.renderer.dispose();
    this.updateCallbacks.length = 0;
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
    // Keep view offset applied — controls.update() may reset projection
    if (this._panOffsetX !== 0 || this._panOffsetY !== 0) this._applyViewOffset();
    this._clampPan();
    for (const cb of this.updateCallbacks) {
      cb(delta);
    }

    // ── Scissor: render only the region around the avatar ──
    const scissor = this._scissorEnabled ? this._computeScissorRect() : null;
    if (scissor) {
      this.renderer.setScissorTest(true);
      this.renderer.setScissor(scissor.x, scissor.y, scissor.w, scissor.h);
      this.renderer.setViewport(0, 0, scissor.fullW, scissor.fullH);
      // Clear only the scissor region (transparent)
      this.renderer.getClearColor(this._scissorClearColor);
      this.renderer.setClearColor(this._scissorClearColor, 0);
      this.renderer.clear(true, true, true);
    } else if (this._scissorEnabled) {
      // Scissor enabled but no VRM loaded yet — still need to clear
      // to prevent stale pixels when autoClear is disabled.
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.clear(true, true, true);
    }

    if (this.customRender) {
      this.customRender(scissor ?? null);
    } else {
      this.renderer.render(this.scene, this.camera);
    }

    if (scissor) {
      this.renderer.setScissorTest(false);
    }
  }

  // ─── Scissor rendering ────────────────────────────────────────────

  /**
   * Enable scissor rendering — only the region around the avatar is rendered.
   * Essential for multi-monitor setups where the canvas spans all screens
   * but the avatar occupies a tiny fraction.
   */
  setScissorEnabled(enabled: boolean): void {
    this._scissorEnabled = enabled;
    if (enabled) {
      this.renderer.autoClear = false;
    } else {
      this.renderer.autoClear = true;
      this.renderer.setScissorTest(false);
    }
  }

  /**
   * Compute the pixel-space scissor rect from the VRM bounding box.
   * Projects all 8 bbox corners to screen space, expands with padding
   * for VFX (particles, trails, bloom bleed), and clamps to canvas bounds.
   *
   * Returns null if no VRM root is set.
   */
  private _computeScissorRect(): { x: number; y: number; w: number; h: number; fullW: number; fullH: number } | null {
    if (!this._vrmRoot) return null;

    this._scissorBbox.setFromObject(this._vrmRoot);
    if (this._scissorBbox.isEmpty()) return null;

    const { min, max } = this._scissorBbox;
    const corners = this._scissorCorners;
    corners[0]!.set(min.x, min.y, min.z);
    corners[1]!.set(min.x, min.y, max.z);
    corners[2]!.set(min.x, max.y, min.z);
    corners[3]!.set(min.x, max.y, max.z);
    corners[4]!.set(max.x, min.y, min.z);
    corners[5]!.set(max.x, min.y, max.z);
    corners[6]!.set(max.x, max.y, min.z);
    corners[7]!.set(max.x, max.y, max.z);

    let ndcMinX = Infinity;
    let ndcMinY = Infinity;
    let ndcMaxX = -Infinity;
    let ndcMaxY = -Infinity;

    for (const c of corners) {
      c.project(this.camera);
      ndcMinX = Math.min(ndcMinX, c.x);
      ndcMinY = Math.min(ndcMinY, c.y);
      ndcMaxX = Math.max(ndcMaxX, c.x);
      ndcMaxY = Math.max(ndcMaxY, c.y);
    }

    // NDC [-1,1] → pixel coordinates
    // WebGL scissor: Y=0 at bottom, measured in framebuffer pixels.
    // canvas.width/height already include pixel ratio (set by renderer.setSize).
    const canvas = this.renderer.domElement;
    const dpr = this.renderer.getPixelRatio();
    const fbW = canvas.width;
    const fbH = canvas.height;
    const pad = SCISSOR_PADDING_PX * dpr;

    let px0 = ((ndcMinX + 1) / 2) * fbW - pad;
    let py0 = ((ndcMinY + 1) / 2) * fbH - pad;  // GL Y: bottom=0
    let px1 = ((ndcMaxX + 1) / 2) * fbW + pad;
    let py1 = ((ndcMaxY + 1) / 2) * fbH + pad;

    // Clamp to framebuffer bounds
    px0 = Math.max(0, Math.floor(px0));
    py0 = Math.max(0, Math.floor(py0));
    px1 = Math.min(fbW, Math.ceil(px1));
    py1 = Math.min(fbH, Math.ceil(py1));

    const w = px1 - px0;
    const h = py1 - py0;
    if (w <= 0 || h <= 0) return null;

    return { x: px0, y: py0, w, h, fullW: fbW, fullH: fbH };
  }

  /** Set a resize callback for external compositors. */
  onResize(fn: ((width: number, height: number) => void) | null): void {
    this.onResizeCallback = fn;
  }

  private handleBeforeUnload(): void {
    if (this.controls && this.cameraSaveTimer) {
      clearTimeout(this.cameraSaveTimer);
      this.cameraSaveTimer = null;
      this._saveCameraAndPan();
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
      if (this._panOffsetX !== 0 || this._panOffsetY !== 0) this._applyViewOffset();
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

  // ─── Pan constants ──────────────────────────────────────────────
  private static readonly CLAMP_MARGIN_Y = 0.9;
  private static readonly CLAMP_MARGIN_X = 1;

  // ─── Pan clamping ────────────────────────────────────────────────
  private _clampRefBone: THREE.Object3D | null = null;
  private _clampBodyBone: THREE.Object3D | null = null;
  private _clampNDC = new THREE.Vector3();
  private _clampWorld = new THREE.Vector3();

  /**
   * Set reference bones for pan clamping.
   * @param headBone — projected to NDC; must stay within viewport vertically
   * @param bodyBone — projected to NDC; must stay ≥50% visible horizontally
   */
  setClampBones(headBone: THREE.Object3D | null, bodyBone?: THREE.Object3D | null): void {
    this._clampRefBone = headBone;
    this._clampBodyBone = bodyBone ?? headBone;
  }

  // ─── View-offset pan helpers ──────────────────────────────────────

  /**
   * Clamp pan offset so the model never fully leaves the viewport.
   * Strategy: temporarily clear the view offset, project the bone to get
   * its "zero-offset" NDC position, then compute the maximum allowed
   * pixel offset from that baseline.
   */
  private _clampPan(): void {
    if (!this._clampRefBone || (this._panOffsetX === 0 && this._panOffsetY === 0)) return;

    const canvas = this.renderer.domElement;
    const w = canvas.width;
    const h = canvas.height;
    if (w === 0 || h === 0) return;

    // Temporarily clear view offset to get the bone's "neutral" NDC position
    this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();

    // Project head at zero offset
    this._clampRefBone.getWorldPosition(this._clampWorld);
    this._clampNDC.copy(this._clampWorld).project(this.camera);
    const headBaseY = this._clampNDC.y;

    // Project body bone at zero offset
    const bodyBone = this._clampBodyBone!;
    bodyBone.getWorldPosition(this._clampWorld);
    this._clampNDC.copy(this._clampWorld).project(this.camera);
    const bodyBaseX = this._clampNDC.x;

    // Restore view offset
    this._applyViewOffset();

    // Convert NDC margin to pixel offset limits.
    // View offset shifts the rendered region: offsetX pixels right = model appears to move left.
    // So: bone NDC = baseNDC - 2 * panOffset / canvasSize
    // We want the final NDC to be within [-margin, +margin]:
    //   -margin <= baseNDC - 2*panOffset/size <= +margin
    //   (baseNDC - margin) * size/2 <= panOffset <= (baseNDC + margin) * size/2

    // Vertical: head stays within viewport
    // panOffsetY positive = viewport shifts down = model moves up in NDC
    // So: headNDC_final ≈ headBaseY + 2 * panOffsetY / h
    const minPanY = (-AvatarScene.CLAMP_MARGIN_Y - headBaseY) * h * 0.5;
    const maxPanY = ( AvatarScene.CLAMP_MARGIN_Y - headBaseY) * h * 0.5;
    this._panOffsetY = Math.max(minPanY, Math.min(maxPanY, this._panOffsetY));

    // Horizontal: body stays within viewport
    // panOffsetX positive = viewport shifts right = model moves left (negative X in NDC)
    // So: bodyNDC_final ≈ bodyBaseX - 2 * panOffsetX / w
    const minPanX = (bodyBaseX - AvatarScene.CLAMP_MARGIN_X) * w * -0.5;
    const maxPanX = (bodyBaseX + AvatarScene.CLAMP_MARGIN_X) * w * -0.5;
    // min/max may be swapped due to negation
    const loX = Math.min(minPanX, maxPanX);
    const hiX = Math.max(minPanX, maxPanX);
    this._panOffsetX = Math.max(loX, Math.min(hiX, this._panOffsetX));

    // Reapply with clamped values
    this._applyViewOffset();
  }

  private _applyViewOffset(): void {
    const canvas = this.renderer.domElement;
    const w = canvas.width;
    const h = canvas.height;
    this.camera.setViewOffset(w, h, this._panOffsetX, this._panOffsetY, w, h);
  }

  /** Reset pan offset (double-click or programmatic). */
  resetPan(): void {
    this._panOffsetX = 0;
    this._panOffsetY = 0;
    this.camera.clearViewOffset();
    this._schedulePanSave();
  }

  private _schedulePanSave(): void {
    if (this.cameraSaveTimer) clearTimeout(this.cameraSaveTimer);
    this.cameraSaveTimer = setTimeout(() => {
      this._saveCameraAndPan();
      this.cameraSaveTimer = null;
    }, CAMERA_SAVE_DEBOUNCE);
  }

  private _saveCameraAndPan(): void {
    if (!this.controls) return;
    saveCameraState({
      distance: this.controls.getDistance(),
      azimuthal: this.controls.getAzimuthalAngle(),
      polar: this.controls.getPolarAngle(),
      panX: this._panOffsetX,
      panY: this._panOffsetY,
    });
  }
}
