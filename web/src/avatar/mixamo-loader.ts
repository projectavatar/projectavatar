/**
 * Loads a Mixamo FBX animation (without skin) and retargets it onto a VRM model.
 *
 * Based on the open-source-avatars reference implementation by ToxSam.
 * Handles VRM 0.x coordinate flipping and hip height scaling.
 */
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';

const mixamoVRMRigMap: Record<string, VRMHumanBoneName> = {
  mixamorigHips:           'hips' as VRMHumanBoneName,
  mixamorigSpine:          'spine' as VRMHumanBoneName,
  mixamorigSpine1:         'chest' as VRMHumanBoneName,
  mixamorigSpine2:         'upperChest' as VRMHumanBoneName,
  mixamorigNeck:           'neck' as VRMHumanBoneName,
  mixamorigHead:           'head' as VRMHumanBoneName,
  mixamorigLeftShoulder:   'leftShoulder' as VRMHumanBoneName,
  mixamorigLeftArm:        'leftUpperArm' as VRMHumanBoneName,
  mixamorigLeftForeArm:    'leftLowerArm' as VRMHumanBoneName,
  mixamorigLeftHand:       'leftHand' as VRMHumanBoneName,
  mixamorigRightShoulder:  'rightShoulder' as VRMHumanBoneName,
  mixamorigRightArm:       'rightUpperArm' as VRMHumanBoneName,
  mixamorigRightForeArm:   'rightLowerArm' as VRMHumanBoneName,
  mixamorigRightHand:      'rightHand' as VRMHumanBoneName,
  mixamorigLeftUpLeg:      'leftUpperLeg' as VRMHumanBoneName,
  mixamorigLeftLeg:        'leftLowerLeg' as VRMHumanBoneName,
  mixamorigLeftFoot:       'leftFoot' as VRMHumanBoneName,
  mixamorigLeftToeBase:    'leftToes' as VRMHumanBoneName,
  mixamorigRightUpLeg:     'rightUpperLeg' as VRMHumanBoneName,
  mixamorigRightLeg:       'rightLowerLeg' as VRMHumanBoneName,
  mixamorigRightFoot:      'rightFoot' as VRMHumanBoneName,
  mixamorigRightToeBase:   'rightToes' as VRMHumanBoneName,
};

// Singleton loader — reused across all animation loads
const fbxLoader = new FBXLoader();

/**
 * Load a Mixamo FBX animation and retarget it to a VRM model.
 *
 * @param url  URL to a Mixamo FBX file (downloaded "without skin")
 * @param vrm  Loaded VRM instance to retarget onto
 * @returns    A THREE.AnimationClip ready to play on vrm.scene
 */
export async function loadMixamoAnimation(
  url: string,
  vrm: VRM,
): Promise<THREE.AnimationClip> {
  const asset = await fbxLoader.loadAsync(url);

  const clip = THREE.AnimationClip.findByName(asset.animations, 'mixamo.com');
  if (!clip) {
    throw new Error(
      `No 'mixamo.com' clip in ${url}. Found: ${asset.animations.map((a) => a.name).join(', ') || 'none'}`,
    );
  }

  const tracks: THREE.KeyframeTrack[] = [];

  // Reusable temporaries
  const restRotationInverse = new THREE.Quaternion();
  const parentRestWorldRotation = new THREE.Quaternion();
  const _quatA = new THREE.Quaternion();
  const _vec3 = new THREE.Vector3();

  // Hip height scaling — match Mixamo proportions to VRM model
  const hipsNode = asset.getObjectByName('mixamorigHips');
  if (!hipsNode) {
    throw new Error(`No 'mixamorigHips' bone in ${url}`);
  }

  const motionHipsHeight = hipsNode.position.y;
  const vrmHipsY =
    vrm.humanoid?.getNormalizedBoneNode('hips' as VRMHumanBoneName)?.getWorldPosition(_vec3).y ?? 0;
  const vrmRootY = vrm.scene.getWorldPosition(_vec3).y;
  const vrmHipsHeight = Math.abs(vrmHipsY - vrmRootY);
  const hipsPositionScale =
    motionHipsHeight > 0 ? vrmHipsHeight / motionHipsHeight : 1;

  const isVRM0 = (vrm.meta as any)?.metaVersion === '0';

  for (const track of clip.tracks) {
    const dotIndex = track.name.indexOf('.');
    if (dotIndex === -1) continue;

    const mixamoRigName = track.name.slice(0, dotIndex);
    const vrmBoneName = mixamoVRMRigMap[mixamoRigName];
    if (!vrmBoneName) continue;

    const vrmNode = vrm.humanoid?.getNormalizedBoneNode(vrmBoneName);
    const vrmNodeName = vrmNode?.name;
    const mixamoRigNode = asset.getObjectByName(mixamoRigName);

    if (vrmNodeName == null || mixamoRigNode == null) continue;

    // Rest pose transforms for retargeting
    // parent may be null for root bones — fall back to identity
    mixamoRigNode.getWorldQuaternion(restRotationInverse).invert();
    if (mixamoRigNode.parent) {
      mixamoRigNode.parent.getWorldQuaternion(parentRestWorldRotation);
    } else {
      parentRestWorldRotation.identity();
    }

    if (track instanceof THREE.QuaternionKeyframeTrack) {
      // Retarget quaternion rotations in-place on a copy
      const values = Float32Array.from(track.values);
      for (let i = 0; i < values.length; i += 4) {
        _quatA
          .fromArray(values, i)
          .premultiply(parentRestWorldRotation)
          .multiply(restRotationInverse);
        _quatA.toArray(values, i);
      }

      // VRM 0.x coordinate flip: negate X and Z (even indices in XYZW layout)
      if (isVRM0) {
        for (let i = 0; i < values.length; i++) {
          if (i % 2 === 0) values[i] = -values[i]!;
        }
      }

      tracks.push(
        new THREE.QuaternionKeyframeTrack(
          `${vrmNodeName}.quaternion`,
          track.times,
          values,
        ),
      );
    } else if (track instanceof THREE.VectorKeyframeTrack) {
      // Retarget position tracks (hips root motion)
      const values = Float32Array.from(track.values);
      for (let i = 0; i < values.length; i++) {
        // VRM 0.x: negate X and Z (indices 0, 2 per vec3)
        if (isVRM0 && i % 3 !== 1) values[i] = -values[i]!;
        values[i] = values[i]! * hipsPositionScale;
      }

      tracks.push(
        new THREE.VectorKeyframeTrack(
          `${vrmNodeName}.position`,
          track.times,
          values,
        ),
      );
    }
  }

  return new THREE.AnimationClip('vrmAnimation', clip.duration, tracks);
}
