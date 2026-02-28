/**
 * Loads a VRMA (VRM Animation) file and retargets it onto a VRM model.
 *
 * VRMA files are glTF-based animations designed specifically for VRM humanoids.
 * Unlike Mixamo FBX, no bone remapping is needed — the @pixiv/three-vrm-animation
 * library handles VRM humanoid → VRM humanoid retargeting natively.
 *
 * VRMA also supports expression animations and gaze data, which FBX cannot carry.
 */
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { AnimationClip } from 'three';
import type { VRM } from '@pixiv/three-vrm';
import {
  VRMAnimationLoaderPlugin,
  createVRMAnimationClip,
} from '@pixiv/three-vrm-animation';

/** Singleton GLTFLoader with VRMAnimationLoaderPlugin registered. */
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
): Promise<AnimationClip> {
  let gltf;
  try {
    gltf = await vrmaLoader.loadAsync(url);
  } catch (err) {
    throw new Error(
      `Failed to load VRMA file: ${url}`,
      { cause: err },
    );
  }

  const vrmAnimations = gltf.userData.vrmAnimations;
  if (!vrmAnimations || vrmAnimations.length === 0) {
    throw new Error(
      `No VRM animations found in ${url}. ` +
      `Ensure the file contains a valid VRMC_vrm_animation extension.`,
    );
  }

  if (vrmAnimations.length > 1) {
    console.warn(
      `[vrma-loader] ${url} contains ${vrmAnimations.length} animations — using the first, discarding the rest.`,
    );
  }

  // createVRMAnimationClip handles all retargeting:
  // - Maps humanoid bone rotations from the animation to the target VRM
  // - Handles expression weight animations (happy, sad, etc.)
  // - Handles gaze/lookAt animations if present
  const clip = createVRMAnimationClip(vrmAnimations[0], vrm);

  return clip;
}
