/**
 * Standalone VRM + FBX clip preview.
 * Loads a VRM model and can play any FBX clip on it — mapped or not.
 * No relay, no WebSocket, no state machine dependency.
 *
 * Uses the same Mixamo retargeting loader as the avatar viewer
 * to ensure consistent animation playback across VRM 0.x and 1.0.
 *
 * Supports bone masking: when a bone mask is set, only tracks for
 * the specified bones are played. Unmasked bones hold their rest pose.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRM, VRMUtils } from '@pixiv/three-vrm';
import { loadMixamoAnimation } from '@avatar/mixamo-loader.ts';

export interface ClipInfo {
  name: string;
  duration: number;
  time: number;
  isPlaying: boolean;
  isLooping: boolean;
  speed: number;
}

export class ClipPreview {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();

  private vrm: VRM | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private currentAction: THREE.AnimationAction | null = null;
  private currentClipName: string | null = null;

  private clipCache = new Map<string, THREE.AnimationClip>();
  private maskedClipCache = new Map<string, THREE.AnimationClip>();
  private _onMixerFinished = () => { this.onClipEnd?.(); };
  private animFrame = 0;
  private _disposed = false;

  private _speed = 1.0;
  private _looping = true;
  private _paused = false;

  /**
   * Bone mask — set of VRM bone names to include.
   * null = no masking (play all tracks).
   * When set, tracks for bones NOT in the set are stripped from playback.
   */
  private _boneMask: Set<string> | null = null;

  get speed() { return this._speed; }
  get looping() { return this._looping; }
  set looping(v: boolean) { this._looping = v; }
  get paused() { return this._paused; }

  /** Callback for frame updates (time, duration, etc.) */
  onFrame?: (info: ClipInfo) => void;
  /** Callback when clip finishes (non-looping) */
  onClipEnd?: () => void;

  constructor(container: HTMLElement) {
    this.container = container;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    container.appendChild(this.renderer.domElement);

    // Scene
    this.scene = new THREE.Scene();

    // Camera
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    this.camera.position.set(0, 1.0, 7.0);
    this.camera.lookAt(0, 0.9, 0);

    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(ambient);
    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(2, 3, 2);
    this.scene.add(dir);
    const fill = new THREE.DirectionalLight(0x8888ff, 0.3);
    fill.position.set(-2, 1, -1);
    this.scene.add(fill);

    // Grid floor
    const grid = new THREE.GridHelper(4, 16, 0x2a2a3a, 0x1a1a2a);
    grid.position.y = 0;
    this.scene.add(grid);

    this._resize();
    window.addEventListener('resize', this._resize);
    this._animate();
  }

  /** Load a VRM model */
  async loadModel(url: string): Promise<void> {
    // Clean up previous
    if (this.vrm) {
      this.scene.remove(this.vrm.scene);
      if (this.mixer) {
        this.mixer.removeEventListener('finished', this._onMixerFinished);
        this.mixer.stopAllAction();
      }
      this.mixer = null;
      this.currentAction = null;
      this.currentClipName = null;
    }

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    const gltf = await loader.loadAsync(url);
    const vrm = gltf.userData.vrm as VRM;
    if (!vrm) throw new Error('No VRM data in loaded file');

    // VRM 0.x faces Z- (away from camera), VRM 1.0 faces Z+ (toward camera).
    // rotateVRM0 only rotates VRM 0.x models, leaving 1.0 untouched.
    VRMUtils.rotateVRM0(vrm);

    this.vrm = vrm;
    this.mixer = new THREE.AnimationMixer(vrm.scene);
    this.scene.add(vrm.scene);

    // Listen for clip completion
    this.mixer.addEventListener('finished', this._onMixerFinished);

    // Clear FBX cache (clips are retargeted per model)
    this.clipCache.clear();
    this.maskedClipCache.clear();
  }

  /**
   * Set the bone mask for preview isolation.
   * Pass null to clear (play all bones).
   * Pass a Set<string> of VRM bone names to isolate playback to those bones.
   *
   * NOTE: This only sets the mask. Call playClip() after to apply it.
   */
  setBoneMask(mask: Set<string> | null): void {
    this._boneMask = mask;
    // Clear masked clip cache — mask changed, old masked clips are stale
    this.maskedClipCache.clear();
  }

  /** Load and play an FBX clip by path */
  async playClip(fbxPath: string, loop?: boolean): Promise<void> {
    if (!this.vrm || !this.mixer) return;

    const shouldLoop = loop ?? this._looping;

    // Load + retarget if not cached (full clip — masking is applied separately)
    let fullClip = this.clipCache.get(fbxPath);
    if (!fullClip) {
      const loaded = await loadMixamoAnimation(fbxPath, this.vrm);
      loaded.name = fbxPath.split('/').pop()?.replace('.fbx', '') ?? fbxPath;
      this.clipCache.set(fbxPath, loaded);
      fullClip = loaded;
    }

    // Apply bone mask if set
    const clip = this._boneMask
      ? this._getMaskedClip(fbxPath, fullClip, this._boneMask)
      : fullClip;

    // Stop current and uncache its clip from the mixer to prevent memory leak
    if (this.currentAction) {
      const oldClip = this.currentAction.getClip();
      this.currentAction.fadeOut(0.3);
      // Uncache masked clips from the mixer (full clips stay in clipCache)
      if (oldClip.name.endsWith('_masked')) {
        this.mixer!.uncacheClip(oldClip);
        this.mixer!.uncacheAction(oldClip);
      }
    }

    // Play new
    const action = this.mixer.clipAction(clip);
    action.setLoop(
      shouldLoop ? THREE.LoopRepeat : THREE.LoopOnce,
      shouldLoop ? Infinity : 1,
    );
    action.clampWhenFinished = !shouldLoop;
    action.setEffectiveTimeScale(this._speed);
    action.fadeIn(0.3);
    action.reset().play();

    this.currentAction = action;
    this.currentClipName = fullClip.name ?? fbxPath;
    this._paused = false;
  }

  /** Stop playback, return to T-pose */
  stop(): void {
    if (this.currentAction) {
      this.currentAction.fadeOut(0.3);
      this.currentAction = null;
      this.currentClipName = null;
    }
  }

  /** Pause / resume */
  togglePause(): void {
    if (!this.currentAction) return;
    this._paused = !this._paused;
    this.currentAction.paused = this._paused;
  }

  /** Set playback speed */
  setSpeed(speed: number): void {
    this._speed = speed;
    if (this.currentAction) {
      this.currentAction.setEffectiveTimeScale(speed);
    }
  }

  /** Seek to a specific time */
  seek(time: number): void {
    if (!this.currentAction) return;
    this.currentAction.time = time;
    if (this._paused) {
      // Advance mixer by 0 to apply the seek
      this.mixer?.update(0);
    }
  }

  /** Get current clip info */
  getClipInfo(): ClipInfo | null {
    if (!this.currentAction || !this.currentClipName) return null;
    return {
      name: this.currentClipName,
      duration: this.currentAction.getClip().duration,
      time: this.currentAction.time,
      isPlaying: this.currentAction.isRunning(),
      isLooping: this._looping,
      speed: this._speed,
    };
  }

  /** Clean up */
  dispose(): void {
    this._disposed = true;
    cancelAnimationFrame(this.animFrame);
    window.removeEventListener('resize', this._resize);
    if (this.mixer) {
      this.mixer.removeEventListener('finished', this._onMixerFinished);
      this.mixer.stopAllAction();
    }
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }

  // ─── Private ──────────────────────────────────────────────────────────

  /**
   * Get or create a masked clip. Caches by fbxPath + mask to avoid
   * creating duplicate clips for the same mask configuration.
   */
  private _getMaskedClip(
    fbxPath: string,
    clip: THREE.AnimationClip,
    allowedBones: Set<string>,
  ): THREE.AnimationClip {
    const cacheKey = fbxPath + ':' + [...allowedBones].sort().join(',');
    const cached = this.maskedClipCache.get(cacheKey);
    if (cached) return cached;

    const masked = this._maskClip(clip, allowedBones);
    this.maskedClipCache.set(cacheKey, masked);
    return masked;
  }

  /**
   * Create a masked version of a clip — only tracks for bones in the
   * allowed set are kept. Creates a new AnimationClip instance
   * (the cached full clip is never mutated).
   */
  private _maskClip(clip: THREE.AnimationClip, allowedBones: Set<string>): THREE.AnimationClip {
    const filteredTracks = clip.tracks.filter((track) => {
      // Track names follow the pattern: "boneName.property"
      const dotIdx = track.name.indexOf('.');
      if (dotIdx === -1) return true; // keep non-bone tracks
      const boneName = track.name.slice(0, dotIdx);

      // Check if this bone's VRM name is in the allowed set.
      // The retargeted clip uses VRM normalized bone node names,
      // so we need to check against those. The humanoid maps
      // VRM bone names to scene node names — we need the reverse.
      // Since we can't reverse-lookup easily, we check if any
      // allowed bone's node name matches.
      if (!this.vrm?.humanoid) return true;

      for (const allowedBone of allowedBones) {
        const node = this.vrm.humanoid.getNormalizedBoneNode(allowedBone as any);
        if (node && node.name === boneName) return true;
      }
      return false;
    });

    const masked = new THREE.AnimationClip(
      clip.name + '_masked',
      clip.duration,
      filteredTracks,
    );
    return masked;
  }

  private _resize = (): void => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  private _animate = (): void => {
    if (this._disposed) return;
    this.animFrame = requestAnimationFrame(this._animate);

    const delta = this.clock.getDelta();

    if (this.mixer && !this._paused) {
      this.mixer.update(delta);
    }

    // Update VRM (spring bones, etc.)
    if (this.vrm) {
      this.vrm.update(delta);
    }

    this.renderer.render(this.scene, this.camera);

    // Frame callback
    const info = this.getClipInfo();
    if (info) this.onFrame?.(info);
  };
}
