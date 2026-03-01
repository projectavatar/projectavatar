import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRM, VRMUtils } from '@pixiv/three-vrm';

/**
 * Manages VRM model loading, switching, and per-frame updates.
 * Falls back to a placeholder cube if no VRM is available.
 */
export class VrmManager {
  private loader: GLTFLoader;
  private scene: THREE.Scene;
  private currentVrm: VRM | null = null;
  private placeholder: THREE.Mesh | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.loader = new GLTFLoader();
    this.loader.register((parser) => new VRMLoaderPlugin(parser));
  }

  get vrm(): VRM | null {
    return this.currentVrm;
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
    vrm.scene.position.y = -0.4;
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
    this.placeholder.position.set(0, 1.2, 0);
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

  /**
   * Make the VRM's eyes track a target object (typically the camera).
   * Uses VRM's built-in lookAt system with autoUpdate.
   */
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
