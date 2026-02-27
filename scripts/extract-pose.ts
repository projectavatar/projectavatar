#!/usr/bin/env npx tsx
/**
 * Extract retargeted VRM 0.x bone rotations from a Mixamo FBX file.
 *
 * Usage:
 *   npx tsx scripts/extract-pose.ts <fbx-file> [frame]
 *   npx tsx scripts/extract-pose.ts web/public/animations/standing-idle.fbx
 *   npx tsx scripts/extract-pose.ts web/public/animations/standing-idle.fbx 0
 *   npx tsx scripts/extract-pose.ts web/public/animations/standing-idle.fbx 30
 *   npx tsx scripts/extract-pose.ts web/public/animations/standing-idle.fbx all
 *
 * Options:
 *   <fbx-file>  Path to a Mixamo FBX file (downloaded "without skin")
 *   [frame]     Frame index to extract (default: 0). Use "all" to dump every frame.
 *
 * Output:
 *   - Retargeted euler angles in VRM 0.x normalized bone space
 *   - Formatted as a TypeScript Record ready to paste into base-pose.ts or recipes
 *   - Also dumps clip metadata (duration, frame count, FPS)
 *
 * The retargeting pipeline matches mixamo-loader.ts exactly:
 *   1. Get parent world rotation + rest rotation inverse
 *   2. premultiply(parentWorldRot).multiply(restRotInverse)
 *   3. Convert to euler (no VRM 0.x flip — normalized bones are version-agnostic)
 */
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { readFileSync } from 'fs';
import { basename } from 'path';

// ─── Args ─────────────────────────────────────────────────────────────────────

const fbxPath = process.argv[2];
const frameArg = process.argv[3] ?? '0';

if (!fbxPath) {
  console.error('Usage: npx tsx scripts/extract-pose.ts <fbx-file> [frame|"all"]');
  console.error('  frame: 0 (default), or any index, or "all"');
  process.exit(1);
}

// ─── Mixamo → VRM bone mapping ────────────────────────────────────────────────

const MIXAMO_TO_VRM: Record<string, string> = {
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

// Ordered for readable output
const BONE_ORDER = [
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
  'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot',
];

// ─── Load FBX ─────────────────────────────────────────────────────────────────

const loader = new FBXLoader();
const buf = readFileSync(fbxPath);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const fbx = loader.parse(ab, '');

const clip = fbx.animations[0];
if (!clip) {
  console.error('No animation clip found in', fbxPath);
  process.exit(1);
}

// ─── Metadata ─────────────────────────────────────────────────────────────────

// Detect frame count from first quaternion track
let frameCount = 0;
for (const track of clip.tracks) {
  if (track.name.endsWith('.quaternion')) {
    frameCount = track.values.length / 4;
    break;
  }
}

const fps = frameCount > 0 ? (frameCount / clip.duration).toFixed(1) : '?';

console.log(`\n╔══════════════════════════════════════════════════════════════╗`);
console.log(`║  FBX: ${basename(fbxPath).padEnd(53)}║`);
console.log(`║  Clip: "${clip.name}"`.padEnd(63) + `║`);
console.log(`║  Duration: ${clip.duration.toFixed(3)}s  Frames: ${frameCount}  FPS: ${fps}`.padEnd(63) + `║`);
console.log(`║  Tracks: ${clip.tracks.length}`.padEnd(63) + `║`);
console.log(`╚══════════════════════════════════════════════════════════════╝\n`);

// ─── Retargeting helpers ──────────────────────────────────────────────────────

const _restRotInv = new THREE.Quaternion();
const _parentRestWorld = new THREE.Quaternion();
const _q = new THREE.Quaternion();

interface BoneTrackInfo {
  vrmBone: string;
  track: THREE.KeyframeTrack;
  mixNode: THREE.Object3D;
}

// Pre-compute bone info
const boneTracks: BoneTrackInfo[] = [];
for (const track of clip.tracks) {
  const dot = track.name.indexOf('.');
  if (dot === -1) continue;
  const mixBone = track.name.slice(0, dot);
  const prop = track.name.slice(dot + 1);
  if (prop !== 'quaternion') continue;

  const vrmBone = MIXAMO_TO_VRM[mixBone];
  if (!vrmBone) continue;

  const mixNode = fbx.getObjectByName(mixBone);
  if (!mixNode) continue;

  boneTracks.push({ vrmBone, track, mixNode });
}

// ─── Extract a single frame ───────────────────────────────────────────────────

function extractFrame(frameIdx: number): Map<string, { x: number; y: number; z: number }> {
  const result = new Map<string, { x: number; y: number; z: number }>();

  for (const { vrmBone, track, mixNode } of boneTracks) {
    const i = frameIdx * 4;
    if (i + 3 >= track.values.length) continue;

    // Rest pose transforms
    mixNode.getWorldQuaternion(_restRotInv).invert();
    if (mixNode.parent) {
      mixNode.parent.getWorldQuaternion(_parentRestWorld);
    } else {
      _parentRestWorld.identity();
    }

    // Frame quaternion → retarget
    _q.set(track.values[i]!, track.values[i + 1]!, track.values[i + 2]!, track.values[i + 3]!)
      .premultiply(_parentRestWorld)
      .multiply(_restRotInv);

    // No VRM 0.x flip — normalized bones have identity rest orientation
    // and a standardized coordinate system regardless of VRM version.
    const euler = new THREE.Euler().setFromQuaternion(_q);

    result.set(vrmBone, { x: euler.x, y: euler.y, z: euler.z });
  }

  return result;
}

// ─── Format output ────────────────────────────────────────────────────────────

function fmt(n: number): string {
  const s = n.toFixed(4);
  return n >= 0 ? ' ' + s : s;  // align positive/negative
}

function printFrame(frameIdx: number, pose: Map<string, { x: number; y: number; z: number }>) {
  const timeStr = clip ? `(t=${((frameIdx / frameCount) * clip.duration).toFixed(3)}s)` : '';
  console.log(`── Frame ${frameIdx} ${timeStr} ──────────────────────────────────────`);
  console.log('');

  // TypeScript-ready format
  console.log('// Paste into base-pose.ts or use as recipe reference:');
  console.log('{');
  for (const bone of BONE_ORDER) {
    const p = pose.get(bone);
    if (!p) continue;
    // Skip bones with near-zero rotation (< 0.01 rad on all axes)
    if (Math.abs(p.x) < 0.01 && Math.abs(p.y) < 0.01 && Math.abs(p.z) < 0.01) continue;
    console.log(`  ${(bone + ':').padEnd(18)} { x: ${fmt(p.x)}, y: ${fmt(p.y)}, z: ${fmt(p.z)} },`);
  }
  console.log('}');
  console.log('');

  // Full table with all bones
  console.log('bone'.padEnd(18) + '  x'.padEnd(10) + '  y'.padEnd(10) + '  z');
  console.log('─'.repeat(48));
  for (const bone of BONE_ORDER) {
    const p = pose.get(bone);
    if (!p) continue;
    console.log(`${bone.padEnd(18)} ${fmt(p.x)}  ${fmt(p.y)}  ${fmt(p.z)}`);
  }
  console.log('');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

if (frameArg === 'all') {
  for (let i = 0; i < frameCount; i++) {
    printFrame(i, extractFrame(i));
  }
} else {
  const frameIdx = parseInt(frameArg, 10);
  if (isNaN(frameIdx) || frameIdx < 0 || frameIdx >= frameCount) {
    console.error(`Invalid frame index: ${frameArg} (valid: 0–${frameCount - 1})`);
    process.exit(1);
  }
  printFrame(frameIdx, extractFrame(frameIdx));
}
