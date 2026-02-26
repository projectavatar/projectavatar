import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { VRM } from '@pixiv/three-vrm';
import type { Prop } from '@project-avatar/shared';

/**
 * Prop spawning and attachment to avatar's right hand bone.
 *
 * Gracefully no-ops if no prop models are available or if the VRM
 * model has no right hand bone. Props are loaded on-demand and cached.
 */

const PROP_PATHS: Partial<Record<Prop, string>> = {
  // Paths will be populated when actual GLB prop models are added.
  // For now, this is empty and all prop requests gracefully no-op.
  // keyboard:         '/assets/props/keyboard.glb',
  // magnifying_glass: '/assets/props/magnifying_glass.glb',
  // coffee_cup:       '/assets/props/coffee_cup.glb',
  // book:             '/assets/props/book.glb',
  // phone:            '/assets/props/phone.glb',
  // scroll:           '/assets/props/scroll.glb',
};

export class PropManager {
  private currentProp: THREE.Object3D | null = null;
  private currentPropName: Prop = 'none';
  private propCache = new Map<string, THREE.Object3D>();
  private handBone: THREE.Object3D | null = null;
  private loader = new GLTFLoader();

  constructor(vrm: VRM) {
    // Get right hand bone from VRM humanoid
    this.handBone = vrm.humanoid?.getNormalizedBoneNode('rightHand') ?? null;

    if (!this.handBone) {
      console.warn('[PropManager] No right hand bone found — props will be unavailable');
    }
  }

  get currentName(): Prop {
    return this.currentPropName;
  }

  /** Set the active prop. Pass 'none' to remove current prop. */
  async setProp(prop: Prop): Promise<void> {
    if (prop === this.currentPropName) return;

    // Remove current prop
    this.removeCurrent();
    this.currentPropName = prop;

    if (prop === 'none' || !this.handBone) return;

    const path = PROP_PATHS[prop];
    if (!path) {
      // No model file for this prop yet — graceful no-op
      return;
    }

    try {
      let model = this.propCache.get(prop);

      if (!model) {
        const gltf = await this.loader.loadAsync(path);
        model = gltf.scene;
        this.propCache.set(prop, model);
      }

      const instance = model.clone();
      this.applyPropTransform(instance, prop);
      this.handBone.add(instance);
      this.currentProp = instance;
    } catch (err) {
      console.warn(`[PropManager] Failed to load prop "${prop}":`, err);
    }
  }

  /** Remove the currently attached prop. */
  removeCurrent(): void {
    if (this.currentProp && this.handBone) {
      this.handBone.remove(this.currentProp);
    }
    this.currentProp = null;
    this.currentPropName = 'none';
  }

  dispose(): void {
    this.removeCurrent();
    this.propCache.clear();
  }

  /** Apply per-prop scale and offset. Tuned manually per prop model. */
  private applyPropTransform(model: THREE.Object3D, prop: Prop): void {
    // Default transform — adjust when real prop models are added
    switch (prop) {
      case 'keyboard':
        model.scale.setScalar(0.1);
        model.position.set(0, -0.05, 0.1);
        break;
      case 'magnifying_glass':
        model.scale.setScalar(0.08);
        model.position.set(0.02, 0, 0.05);
        break;
      case 'coffee_cup':
        model.scale.setScalar(0.06);
        model.position.set(0, -0.02, 0.04);
        break;
      case 'book':
        model.scale.setScalar(0.1);
        model.position.set(0, 0, 0.08);
        break;
      case 'phone':
        model.scale.setScalar(0.05);
        model.position.set(0, 0, 0.03);
        break;
      case 'scroll':
        model.scale.setScalar(0.08);
        model.position.set(0, 0, 0.06);
        break;
      default:
        model.scale.setScalar(0.08);
    }
  }
}
