import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/**
 * Core Three.js scene: camera, lighting, renderer, render loop.
 * Pure Three.js — no React, no VRM-specific logic.
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
}

const DEFAULT_GRID_SIZE = 4;
const DEFAULT_GRID_DIVISIONS = 16;

export class AvatarScene {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly clock: THREE.Clock;

  private controls: OrbitControls | null = null;
  private animationFrameId: number | null = null;
  private backgroundIntervalId: ReturnType<typeof setInterval> | null = null;
  private updateCallbacks: Array<(delta: number) => void> = [];

  constructor(canvas: HTMLCanvasElement, options?: AvatarSceneOptions) {
    this.scene = new THREE.Scene();

    // Camera: positioned for upper body framing
    this.camera = new THREE.PerspectiveCamera(
      30,
      canvas.clientWidth / canvas.clientHeight,
      0.1,
      20,
    );
    this.camera.position.set(1.70, 0.8, 5.23);
    this.camera.lookAt(0, 0.7, 0);

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
      grid.position.y = -0.4;
      this.scene.add(grid);
    }

    // Optional orbit controls (mouse rotate + zoom)
    if (options?.orbit) {
      this.controls = new OrbitControls(this.camera, canvas);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.08;
      this.controls.target.set(0, 0.7, 0);
      this.controls.minDistance = 1;
      this.controls.maxDistance = 15;
      this.controls.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.ROTATE,
      };
      this.controls.update();
    }

    this.clock = new THREE.Clock();

    // Handle window resize
    this.handleResize = this.handleResize.bind(this);
    window.addEventListener('resize', this.handleResize);

    // Handle background tab throttling
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
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

  /** Full cleanup — call when unmounting. */
  dispose(): void {
    this.stop();
    this.controls?.dispose();
    window.removeEventListener('resize', this.handleResize);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.renderer.dispose();
    this.updateCallbacks.length = 0;
  }

  private loop = (): void => {
    this.animationFrameId = requestAnimationFrame(this.loop);
    this.tick();
  };

  private tick(): void {
    const delta = this.clock.getDelta();
    this.controls?.update();
    for (const cb of this.updateCallbacks) {
      cb(delta);
    }
    this.renderer.render(this.scene, this.camera);
  }

  private handleResize(): void {
    const canvas = this.renderer.domElement;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== width || canvas.height !== height) {
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
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
