import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRM, VRMUtils } from '@pixiv/three-vrm';

/** Target height for all VRM models (meters). */
const TARGET_HEIGHT = 1.6;

/**
 * Manages VRM model loading, switching, and per-frame updates.
 * Falls back to a placeholder cube if no VRM is available.
 *
 * All loaded VRMs are normalized to TARGET_HEIGHT and repositioned
 * so that the hips bone sits at the world origin (0, 0, 0).
 */
export class VrmManager {
  private loader: GLTFLoader;
  private scene: THREE.Scene;
  private currentVrm: VRM | null = null;
  private placeholder: THREE.Mesh | null = null;

  /** Body center — hips at origin. */
  private _bodyCenter = new THREE.Vector3(0, 0, 0);
  /** Face center — computed from head bone after load. */
  private _faceCenter = new THREE.Vector3(0, 0.5, 0);

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.loader = new GLTFLoader();
    this.loader.register((parser) => new VRMLoaderPlugin(parser));
  }

  get vrm(): VRM | null {
    return this.currentVrm;
  }

  /** Hips / body center — use as zoom-out orbit target. */
  get bodyCenter(): THREE.Vector3 {
    return this._bodyCenter.clone();
  }

  /** Head / face center — use as zoom-in orbit target. */
  get faceCenter(): THREE.Vector3 {
    return this._faceCenter.clone();
  }

  /** Load a VRM model from URL. Returns the VRM instance. */
  async load(url: string, onProgress?: (pct: number) => void): Promise<VRM> {
    // Remove previous model or placeholder
    this.removeCurrent();

    const gltf = await this.loader.loadAsync(url, (evt) => {
      if (evt.total > 0) {
        onProgress?.(evt.loaded / evt.total);
      }
    });

    const vrm = gltf.userData.vrm as VRM | undefined;
    if (!vrm) {
      throw new Error('Loaded file is not a valid VRM model');
    }

    // VRM 0.x faces Z- (away from camera), VRM 1.0 faces Z+ (toward camera).
    // rotateVRM0 only rotates VRM 0.x models to face forward, leaving 1.0 untouched.
    VRMUtils.rotateVRM0(vrm);

    // --- Normalize height to TARGET_HEIGHT ---
    vrm.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(vrm.scene);
    const naturalHeight = box.max.y - box.min.y;
    if (naturalHeight > 0) {
      const scale = TARGET_HEIGHT / naturalHeight;
      vrm.scene.scale.multiplyScalar(scale);
    }

    // --- Center hips at origin (0, 0, 0) ---
    vrm.scene.updateMatrixWorld(true);
    const hipsBone = vrm.humanoid?.getNormalizedBoneNode('hips');
    if (hipsBone) {
      const hipsWorld = new THREE.Vector3();
      hipsBone.getWorldPosition(hipsWorld);
      vrm.scene.position.sub(hipsWorld);
    }

    // --- Compute framing points ---
    vrm.scene.updateMatrixWorld(true);
    this._bodyCenter.set(0, 0, 0); // hips = origin
    this._computeFaceCenter(vrm);

    this.scene.add(vrm.scene);
    this.currentVrm = vrm;

    return vrm;
  }

  /** Show a rotating placeholder cube (used when no VRM model is available). */
  showPlaceholder(): void {
    this.removeCurrent();

    const geometry = new THREE.BoxGeometry(0.4, 0.4, 0.4);
    const material = new THREE.MeshStandardMaterial({
      color: 0x6c5ce7,
      metalness: 0.3,
      roughness: 0.7,
    });
    this.placeholder = new THREE.Mesh(geometry, material);
    this.placeholder.position.set(0, 0, 0);
    this.scene.add(this.placeholder);

    console.warn('[VrmManager] No VRM model loaded — showing placeholder cube');
  }

  /** Call every frame. Updates VRM spring bones or rotates placeholder. */
  update(delta: number): void {
    if (this.currentVrm) {
      this.currentVrm.update(delta);
    } else if (this.placeholder) {
      this.placeholder.rotation.x += delta * 0.5;
      this.placeholder.rotation.y += delta * 0.8;
    }
  }

  /** Enable/disable VRM lookAt auto-update. */
  setLookAtEnabled(enabled: boolean): void {
    if (this.currentVrm?.lookAt) {
      this.currentVrm.lookAt.autoUpdate = enabled;
    }
  }

  setLookAtTarget(target: THREE.Object3D): void {
    if (this.currentVrm?.lookAt) {
      this.currentVrm.lookAt.target = target;
      this.currentVrm.lookAt.autoUpdate = true;
    }
  }

  /** Clean up current model/placeholder. */
  dispose(): void {
    this.removeCurrent();
  }

  /**
   * Compute the face/head center from actual bone positions.
   * Uses head bone, falling back to neck + offset.
   */
  private _computeFaceCenter(vrm: VRM): void {
    const h = vrm.humanoid;
    if (!h) return;

    const headBone = h.getNormalizedBoneNode('head');
    const neckBone = h.getNormalizedBoneNode('neck');

    if (headBone) {
      headBone.getWorldPosition(this._faceCenter);
    } else if (neckBone) {
      neckBone.getWorldPosition(this._faceCenter);
      this._faceCenter.y += 0.08; // approximate head center above neck
    }
    // else: keep default (0, 0.5, 0)
  }

  private removeCurrent(): void {
    if (this.currentVrm) {
      this.scene.remove(this.currentVrm.scene);
      VRMUtils.deepDispose(this.currentVrm.scene);
      this.currentVrm = null;
    }
    if (this.placeholder) {
      this.scene.remove(this.placeholder);
      this.placeholder.geometry.dispose();
      if (this.placeholder.material instanceof THREE.Material) {
        this.placeholder.material.dispose();
      }
      this.placeholder = null;
    }
  }
}
