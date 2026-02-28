/**
 * Loads a VRMA (VRM Animation) file and retargets it onto a VRM model.
 *
 * VRMA files are glTF-based animations designed specifically for VRM humanoids.
 * Unlike Mixamo FBX, no bone remapping is needed — the @pixiv/three-vrm-animation
 * library handles VRM humanoid → VRM humanoid retargeting natively.
 *
 * VRMA also supports expression animations and gaze data, which FBX cannot carry.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { VRM } from '@pixiv/three-vrm';
import {
  VRMAnimationLoaderPlugin,
  createVRMAnimationClip,
} from '@pixiv/three-vrm-animation';

// Singleton loader with VRMA plugin registered
const vrmaLoader = new GLTFLoader();
vrmaLoader.register((parser) => new VRMAnimationLoaderPlugin(parser));

/**
 * Load a VRMA animation file and retarget it to a VRM model.
 *
 * @param url  URL to a .vrma file
 * @param vrm  Loaded VRM instance to retarget onto
 * @returns    A THREE.AnimationClip ready to play on vrm.scene
 */
export async function loadVRMAAnimation(
  url: string,
  vrm: VRM,
): Promise<THREE.AnimationClip> {
  const gltf = await vrmaLoader.loadAsync(url);

  const vrmAnimations = gltf.userData.vrmAnimations;
  if (!vrmAnimations || vrmAnimations.length === 0) {
    throw new Error(
      `No VRM animations found in ${url}. ` +
      `Ensure the file contains a valid VRMC_vrm_animation extension.`,
    );
  }

  // Use the first animation in the file (VRMA files typically contain one)
  const vrmAnimation = vrmAnimations[0];

  // createVRMAnimationClip handles all retargeting:
  // - Maps humanoid bone rotations from the animation to the target VRM
  // - Handles expression weight animations (happy, sad, etc.)
  // - Handles gaze/lookAt animations if present
  const clip = createVRMAnimationClip(vrmAnimation, vrm);

  return clip;
}
