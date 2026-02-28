/**
 * Clip preview — composes avatar-engine primitives for the clip manager.
 *
 * Three modes:
 * 1. Raw clip playback: plays a single FBX with bone masking (for clip editing)
 * 2. Full engine: AnimationController + ExpressionController + BlinkController
 *    with layer toggles (for mimicking the main web app's behavior)
 * 3. Action preview: plays a blended action through the engine (for action editing)
 *    — supports specifying a group index for previewing specific animation groups
 */
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { Action as ActionName } from '@project-avatar/shared';
import {
  AvatarScene,
  VrmManager,
  AnimationController,
  ExpressionController,
  BlinkController,
  ClipRegistry,
  loadMixamoAnimation,
  loadVRMAAnimation,
} from '@project-avatar/avatar-engine';
import type { LayerState, ClipsJsonData } from '@project-avatar/avatar-engine';

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
  private canvas: HTMLCanvasElement;
  private avatarScene: AvatarScene;
  private vrmManager: VrmManager;

  private vrm: VRM | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private currentAction: THREE.AnimationAction | null = null;
  private currentClipName: string | null = null;

  private clipCache = new Map<string, THREE.AnimationClip>();
  private maskedClipCache = new Map<string, THREE.AnimationClip>();

  private _speed = 1.0;
  private _looping = true;
  private _paused = false;
  private _boneMask: Set<string> | null = null;
  private _disposed = false;

  // ─── Engine mode ────────────────────────────────────────────────────────
  private animCtrl: AnimationController | null = null;
  private exprCtrl: ExpressionController | null = null;
  private blinkCtrl: BlinkController | null = null;
  private registry: ClipRegistry | null = null;
  private _engineActive = false;
  private _layers: LayerState = {
    fbxClips: true,
    expressions: true,
    blink: true,
    idleLayer: true,
  };

  get speed() { return this._speed; }
  get looping() { return this._looping; }
  set looping(v: boolean) { this._looping = v; }
  get paused() { return this._paused; }
  get engineActive() { return this._engineActive; }

  /** Callback for frame updates */
  onFrame?: (info: ClipInfo) => void;
  /** Callback when clip finishes (non-looping) */
  onClipEnd?: () => void;

  constructor(container: HTMLElement) {
    this.container = container;

    this.canvas = document.createElement('canvas');
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
    container.appendChild(this.canvas);

    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w > 0 && h > 0) {
      this.canvas.width = w;
      this.canvas.height = h;
    }

    this.avatarScene = new AvatarScene(this.canvas, { grid: true });
    this.avatarScene.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.avatarScene.renderer.toneMappingExposure = 1.0;

    this.avatarScene.camera.position.set(0, 1.0, 7.0);
    this.avatarScene.camera.lookAt(0, 0.9, 0);

    this.vrmManager = new VrmManager(this.avatarScene.scene);

    this.avatarScene.onUpdate((delta) => {
      if (this._disposed) return;

      if (this._engineActive) {
        if (!this._paused) this.animCtrl!.update(delta);
        const layers = this.animCtrl!.layers;
        if (layers.expressions) {
          this.exprCtrl!.update(delta, layers.expressions);
        }
        if (layers.blink) {
          this.blinkCtrl!.update(delta);
        }
      } else {
        if (this.mixer && !this._paused) {
          this.mixer.update(delta);
        }
      }

      if (this.vrm) {
        this.vrm.update(delta);
      }

      const info = this.getClipInfo();
      if (info) this.onFrame?.(info);
    });

    this.avatarScene.start();
  }

  async loadModel(url: string): Promise<void> {
    this._engineActive = false;
    this.animCtrl = null;
    this.exprCtrl = null;
    this.blinkCtrl = null;
    this.registry = null;

    if (this.mixer) {
      this.mixer.stopAllAction();
    }
    this.mixer = null;
    this.currentAction = null;
    this.currentClipName = null;
    this.clipCache.clear();
    this.maskedClipCache.clear();

    const vrm = await this.vrmManager.load(url);
    this.vrm = vrm;
    this.mixer = new THREE.AnimationMixer(vrm.scene);

    this.mixer.addEventListener('finished', () => {
      this.onClipEnd?.();
    });
  }

  async enableEngine(clipsData: ClipsJsonData): Promise<void> {
    if (!this.vrm) throw new Error('Load a model first');

    this.registry = new ClipRegistry(clipsData);
    this.animCtrl = new AnimationController(this.vrm, this.registry);
    this.exprCtrl = new ExpressionController(this.vrm);
    this.blinkCtrl = new BlinkController(this.vrm);

    for (const [layer, enabled] of Object.entries(this._layers)) {
      this.animCtrl.setLayer(layer as keyof LayerState, enabled);
    }

    await this.animCtrl.loadAnimations();
    this._engineActive = true;
  }

  /** Update the clip registry data without re-initializing the engine. */
  updateEngineData(clipsData: ClipsJsonData): void {
    if (this.registry) {
      this.registry.setData(clipsData);
    }
  }

  /**
   * Play a blended action through the animation engine.
   * Optionally specify a group index to preview a specific animation group.
   */
  playEngineAction(action: ActionName, groupIndex?: number): void {
    if (!this.animCtrl || !this._engineActive) return;
    // Use playActionWithGroup for explicit group selection
    if (groupIndex !== undefined) {
      this.animCtrl.playActionWithGroup(action, 'medium', 'idle', groupIndex);
    } else {
      this.animCtrl.playAction(action, 'medium', 'idle', true);
    }
    this.currentClipName = null; // Clear single-clip info
  }

  setLayer(layer: keyof LayerState, enabled: boolean): void {
    this._layers[layer] = enabled;
    if (this.animCtrl) {
      this.animCtrl.setLayer(layer, enabled);
    }
  }

  get layers(): Readonly<LayerState> {
    return this._layers;
  }

  setBoneMask(mask: Set<string> | null): void {
    this._boneMask = mask;
    this.maskedClipCache.clear();
  }

  async playClip(clipPath: string, loop?: boolean): Promise<void> {
    if (!this.vrm || !this.mixer) return;

    if (this._engineActive) {
      this._engineActive = false;
    }

    const shouldLoop = loop ?? this._looping;

    let fullClip = this.clipCache.get(clipPath);
    if (!fullClip) {
      const loaded = clipPath.toLowerCase().endsWith('.vrma')
        ? await loadVRMAAnimation(clipPath, this.vrm)
        : await loadMixamoAnimation(clipPath, this.vrm);
      loaded.name = clipPath.split('/').pop()?.replace(/\.(fbx|vrma)$/i, '') ?? clipPath;
      this.clipCache.set(clipPath, loaded);
      fullClip = loaded;
    }

    const clip = this._boneMask
      ? this._getMaskedClip(clipPath, fullClip, this._boneMask)
      : fullClip;

    if (this.currentAction) {
      const oldClip = this.currentAction.getClip();
      this.currentAction.fadeOut(0.3);
      if (oldClip.name.endsWith('_masked')) {
        this.mixer!.uncacheClip(oldClip);
        this.mixer!.uncacheAction(oldClip);
      }
    }

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
    this.currentClipName = fullClip.name ?? clipPath;
    this._paused = false;
  }

  stop(): void {
    if (this.currentAction) {
      this.currentAction.fadeOut(0.3);
      this.currentAction = null;
      this.currentClipName = null;
    }
    // If engine active, return to idle
    if (this._engineActive && this.animCtrl) {
      this.animCtrl.playAction('idle', 'medium', 'idle');
    }
  }

  togglePause(): void {
    if (this._engineActive) {
      this._paused = !this._paused;
      return;
    }
    if (!this.currentAction) return;
    this._paused = !this._paused;
    this.currentAction.paused = this._paused;
  }

  setSpeed(speed: number): void {
    this._speed = speed;
    if (this.currentAction) {
      this.currentAction.setEffectiveTimeScale(speed);
    }
  }

  seek(time: number): void {
    if (!this.currentAction) return;
    this.currentAction.time = time;
    if (this._paused) {
      this.mixer?.update(0);
    }
  }

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

  dispose(): void {
    this._disposed = true;
    this.animCtrl?.dispose();
    if (this.mixer) {
      this.mixer.stopAllAction();
    }
    this.vrmManager.dispose();
    this.avatarScene.dispose();
    if (this.canvas.parentNode === this.container) {
      this.container.removeChild(this.canvas);
    }
  }

  // ─── Private ──────────────────────────────────────────────────────────

  private _getMaskedClip(
    clipPath: string,
    clip: THREE.AnimationClip,
    allowedBones: Set<string>,
  ): THREE.AnimationClip {
    const cacheKey = clipPath + ':' + [...allowedBones].sort().join(',');
    const cached = this.maskedClipCache.get(cacheKey);
    if (cached) return cached;

    const masked = this._maskClip(clip, allowedBones);
    this.maskedClipCache.set(cacheKey, masked);
    return masked;
  }

  private _maskClip(clip: THREE.AnimationClip, allowedBones: Set<string>): THREE.AnimationClip {
    const filteredTracks = clip.tracks.filter((track) => {
      const dotIdx = track.name.indexOf('.');
      if (dotIdx === -1) return true;
      const boneName = track.name.slice(0, dotIdx);

      if (!this.vrm?.humanoid) return true;

      for (const allowedBone of allowedBones) {
        const node = this.vrm.humanoid.getNormalizedBoneNode(allowedBone as any);
        if (node && node.name === boneName) return true;
      }
      return false;
    });

    return new THREE.AnimationClip(
      clip.name + '_masked',
      clip.duration,
      filteredTracks,
    );
  }
}
