/**
 * Loads a Mixamo FBX animation (without skin) and retargets it onto a VRM model.
 * Based on the open-source-avatars reference implementation.
 * VRM 0.x only — applies coordinate flip for metaVersion '0'.
 */
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';

const mixamoVRMRigMap: Record<string, VRMHumanBoneName> = {
  mixamorigHips:           'hips',
  mixamorigSpine:          'spine',
  mixamorigSpine1:         'chest',
  mixamorigSpine2:         'upperChest',
  mixamorigNeck:           'neck',
  mixamorigHead:           'head',
  mixamorigLeftShoulder:   'leftShoulder',
  mixamorigLeftArm:        'leftUpperArm',
  mixamorigLeftForeArm:    'leftLowerArm',
  mixamorigLeftHand:       'leftHand',
  mixamorigRightShoulder:  'rightShoulder',
  mixamorigRightArm:       'rightUpperArm',
  mixamorigRightForeArm:   'rightLowerArm',
  mixamorigRightHand:      'rightHand',
  mixamorigLeftUpLeg:      'leftUpperLeg',
  mixamorigLeftLeg:        'leftLowerLeg',
  mixamorigLeftFoot:       'leftFoot',
  mixamorigLeftToeBase:    'leftToes',
  mixamorigRightUpLeg:     'rightUpperLeg',
  mixamorigRightLeg:       'rightLowerLeg',
  mixamorigRightFoot:      'rightFoot',
  mixamorigRightToeBase:   'rightToes',
};

const loader = new FBXLoader();

export async function loadMixamoAnimation(url: string, vrm: VRM): Promise<THREE.AnimationClip> {
  const asset = await new Promise<THREE.Group>((resolve, reject) => {
    loader.load(url, resolve, undefined, reject);
  });

  const clip = THREE.AnimationClip.findByName(asset.animations, 'mixamo.com');
  if (!clip) throw new Error(`No mixamo.com clip found in ${url}`);

  const tracks: THREE.KeyframeTrack[] = [];
  const restRotationInverse = new THREE.Quaternion();
  const parentRestWorldRotation = new THREE.Quaternion();
  const _quatA = new THREE.Quaternion();
  const _vec3 = new THREE.Vector3();

  const hipsNode = asset.getObjectByName('mixamorigHips');
  if (!hipsNode) throw new Error('No mixamorigHips bone in FBX');

  const motionHipsHeight = hipsNode.position.y;
  const vrmHipsY = vrm.humanoid?.getNormalizedBoneNode('hips')?.getWorldPosition(_vec3).y ?? 0;
  const vrmRootY = vrm.scene.getWorldPosition(_vec3).y;
  const vrmHipsHeight = Math.abs(vrmHipsY - vrmRootY);
  const hipsPositionScale = vrmHipsHeight / motionHipsHeight;

  const isVRM0 = vrm.meta?.metaVersion === '0';

  for (const track of clip.tracks) {
    const parts = track.name.split('.');
    const mixamoRigName = parts[0];
    const propertyName = parts[1];
    const vrmBoneName = mixamoVRMRigMap[mixamoRigName];
    if (!vrmBoneName) continue;

    const vrmNode = vrm.humanoid?.getNormalizedBoneNode(vrmBoneName);
    const vrmNodeName = vrmNode?.name;
    const mixamoRigNode = asset.getObjectByName(mixamoRigName);

    if (!vrmNodeName || !mixamoRigNode) continue;

    mixamoRigNode.getWorldQuaternion(restRotationInverse).invert();
    mixamoRigNode.parent!.getWorldQuaternion(parentRestWorldRotation);

    if (track instanceof THREE.QuaternionKeyframeTrack) {
      for (let i = 0; i < track.values.length; i += 4) {
        _quatA.fromArray(track.values, i)
          .premultiply(parentRestWorldRotation)
          .multiply(restRotationInverse);
        _quatA.toArray(track.values, i);
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(
        `${vrmNodeName}.${propertyName}`,
        track.times,
        track.values.map((v, i) => (isVRM0 && i % 2 === 0 ? -v : v)),
      ));
    } else if (track instanceof THREE.VectorKeyframeTrack) {
      tracks.push(new THREE.VectorKeyframeTrack(
        `${vrmNodeName}.${propertyName}`,
        track.times,
        track.values.map((v, i) => (isVRM0 && i % 3 !== 1 ? -v : v) * hipsPositionScale),
      ));
    }
  }

  return new THREE.AnimationClip('vrmAnimation', clip.duration, tracks);
}
