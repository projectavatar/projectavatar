/**
 * Procedural animation recipes for all 29 actions.
 *
 * Each recipe is a declarative description of bone movements.
 * The engine evaluates them every frame — no FBX files, no mixer,
 * no retargeting. Pure math → bone rotations.
 *
 * Rotation values are in radians. Positive directions:
 *   x = pitch (nod down)
 *   y = yaw (turn left)
 *   z = roll (tilt right, for left-side bones)
 *
 * Adding a new action = adding a new recipe here. That's it.
 */
import type { Recipe } from './types.ts';
import type { Action } from '@project-avatar/shared';

// ─── Recipe Definitions ───────────────────────────────────────────────────────

const idle: Recipe = {
  name: 'idle',
  bones: [],
  // Empty — the idle layer handles everything.
  // This exists so the engine has a valid recipe for 'idle'.
  loop: true,
  fadeIn: 0.5,
  fadeOut: 0.5,
};

const talking: Recipe = {
  name: 'talking',
  bones: [
    // Animated hand gestures while speaking
    {
      bone: 'rightUpperArm',
      primitives: [
        { kind: 'reach', axis: 'z', target: -0.15, duration: 0.4 },
        { kind: 'oscillate', axis: 'x', amplitude: 0.06, period: 1.8, phase: 0 },
      ],
    },
    {
      bone: 'rightLowerArm',
      primitives: [
        { kind: 'reach', axis: 'x', target: -0.3, duration: 0.3 },
        { kind: 'oscillate', axis: 'x', amplitude: 0.08, period: 1.4, phase: 0.5 },
      ],
    },
    {
      bone: 'leftUpperArm',
      primitives: [
        { kind: 'oscillate', axis: 'x', amplitude: 0.03, period: 2.2, phase: 1.0 },
      ],
    },
    // Head nods along with speech rhythm
    {
      bone: 'head',
      primitives: [
        { kind: 'oscillate', axis: 'x', amplitude: 0.03, period: 1.6 },
        { kind: 'noise', axis: 'y', amplitude: 0.02, speed: 0.8, seed: 20 },
      ],
    },
    // Slight torso engagement
    {
      bone: 'chest',
      primitives: [
        { kind: 'oscillate', axis: 'y', amplitude: 0.015, period: 2.0 },
      ],
    },
  ],
  loop: true,
  fadeIn: 0.3,
  fadeOut: 0.5,
};

const typing: Recipe = {
  name: 'typing',
  bones: [
    // Arms forward and down, elbows bent
    {
      bone: 'rightUpperArm',
      primitives: [
        { kind: 'reach', axis: 'x', target: 0.6, duration: 0.4 },
        { kind: 'reach', axis: 'z', target: -0.2, duration: 0.4 },
      ],
    },
    {
      bone: 'leftUpperArm',
      primitives: [
        { kind: 'reach', axis: 'x', target: 0.6, duration: 0.4 },
        { kind: 'reach', axis: 'z', target: 0.2, duration: 0.4 },
      ],
    },
    {
      bone: 'rightLowerArm',
      primitives: [
        { kind: 'reach', axis: 'x', target: -0.9, duration: 0.3 },
      ],
    },
    {
      bone: 'leftLowerArm',
      primitives: [
        { kind: 'reach', axis: 'x', target: -0.9, duration: 0.3 },
      ],
    },
    // Subtle finger/hand wiggle to simulate keystrokes
    {
      bone: 'rightHand',
      primitives: [
        { kind: 'oscillate', axis: 'x', amplitude: 0.06, period: 0.25 },
        { kind: 'oscillate', axis: 'z', amplitude: 0.03, period: 0.35, phase: 1.0 },
      ],
    },
    {
      bone: 'leftHand',
      primitives: [
        { kind: 'oscillate', axis: 'x', amplitude: 0.06, period: 0.28, phase: 0.5 },
        { kind: 'oscillate', axis: 'z', amplitude: 0.03, period: 0.38, phase: 1.5 },
      ],
    },
    // Head slightly forward, focused on screen
    {
      bone: 'head',
      primitives: [
        { kind: 'reach', axis: 'x', target: 0.08, duration: 0.5 },
        { kind: 'noise', axis: 'y', amplitude: 0.01, speed: 0.3, seed: 30 },
      ],
    },
    {
      bone: 'chest',
      primitives: [
        { kind: 'reach', axis: 'x', target: 0.04, duration: 0.5 },
      ],
    },
  ],
  loop: true,
  fadeIn: 0.4,
  fadeOut: 0.6,
};

const nodding: Recipe = {
  name: 'nodding',
  bones: [
    {
      bone: 'head',
      primitives: [
        { kind: 'oscillate', axis: 'x', amplitude: 0.12, period: 0.6 },
      ],
    },
    {
      bone: 'neck',
      primitives: [
        { kind: 'oscillate', axis: 'x', amplitude: 0.04, period: 0.6, phase: 0.3 },
      ],
    },
  ],
  loop: false,
  duration: 1.8,  // 3 nods
  fadeIn: 0.15,
  fadeOut: 0.4,
};

const waving: Recipe = {
  name: 'waving',
  bones: [
    // Raise right arm
    {
      bone: 'rightUpperArm',
      primitives: [
        { kind: 'reach', axis: 'x', target: -0.3, duration: 0.3 },
        { kind: 'reach', axis: 'z', target: -1.2, duration: 0.3 },
      ],
    },
    {
      bone: 'rightLowerArm',
      primitives: [
        { kind: 'reach', axis: 'x', target: -0.5, duration: 0.25 },
      ],
    },
    // Wave hand back and forth
    {
      bone: 'rightHand',
      primitives: [
        { kind: 'oscillate', axis: 'z', amplitude: 0.4, period: 0.4 },
      ],
    },
    // Slight body lean toward wave
    {
      bone: 'spine',
      primitives: [
        { kind: 'reach', axis: 'z', target: -0.03, duration: 0.4 },
      ],
    },
    {
      bone: 'head',
      primitives: [
        { kind: 'reach', axis: 'z', target: -0.04, duration: 0.3 },
      ],
    },
  ],
  loop: false,
  duration: 2.5,
  fadeIn: 0.2,
  fadeOut: 0.5,
};

const greeting: Recipe = {
  name: 'greeting',
  bones: [
    // Slight bow + open posture
    {
      bone: 'chest',
      primitives: [
        { kind: 'recoil', axis: 'x', peakAngle: 0.12, settleAngle: 0.04, attackTime: 0.3, settleTime: 0.5 },
      ],
    },
    {
      bone: 'head',
      primitives: [
        { kind: 'recoil', axis: 'x', peakAngle: 0.08, settleAngle: -0.02, attackTime: 0.3, settleTime: 0.5 },
      ],
    },
    // Arms slightly open
    {
      bone: 'rightUpperArm',
      primitives: [
        { kind: 'reach', axis: 'z', target: -0.2, duration: 0.4 },
      ],
    },
    {
      bone: 'leftUpperArm',
      primitives: [
        { kind: 'reach', axis: 'z', target: 0.2, duration: 0.4 },
      ],
    },
  ],
  loop: false,
  duration: 2.0,
  fadeIn: 0.2,
  fadeOut: 0.6,
};

const laughing: Recipe = {
  name: 'laughing',
  bones: [
    // Bouncy torso
    {
      bone: 'chest',
      primitives: [
        { kind: 'oscillate', axis: 'x', amplitude: 0.06, period: 0.35 },
      ],
    },
    {
      bone: 'spine',
      primitives: [
        { kind: 'oscillate', axis: 'x', amplitude: 0.04, period: 0.35, phase: 0.2 },
      ],
    },
    // Head thrown back slightly then bouncing
    {
      bone: 'head',
      primitives: [
        { kind: 'reach', axis: 'x', target: -0.06, duration: 0.2 },
        { kind: 'oscillate', axis: 'x', amplitude: 0.04, period: 0.35, phase: 0.5 },
      ],
    },
    // Shoulders shake
    {
      bone: 'leftShoulder',
      primitives: [
        { kind: 'oscillate', axis: 'z', amplitude: 0.04, period: 0.35 },
      ],
    },
    {
      bone: 'rightShoulder',
      primitives: [
        { kind: 'oscillate', axis: 'z', amplitude: 0.04, period: 0.35, phase: Math.PI },
      ],
    },
  ],
  loop: false,
  duration: 3.0,
  fadeIn: 0.15,
  fadeOut: 0.6,
};

const pointing: Recipe = {
  name: 'pointing',
  bones: [
    // Extend right arm forward
    {
      bone: 'rightUpperArm',
      primitives: [
        { kind: 'reach', axis: 'x', target: 0.8, duration: 0.3 },
        { kind: 'reach', axis: 'z', target: -0.3, duration: 0.3 },
      ],
    },
    {
      bone: 'rightLowerArm',
      primitives: [
        { kind: 'reach', axis: 'x', target: -0.15, duration: 0.25 },
      ],
    },
    // Lean slightly into the point
    {
      bone: 'chest',
      primitives: [
        { kind: 'reach', axis: 'y', target: 0.06, duration: 0.35 },
      ],
    },
    {
      bone: 'head',
      primitives: [
        { kind: 'reach', axis: 'y', target: 0.08, duration: 0.3 },
      ],
    },
  ],
  loop: false,
  duration: 2.0,
  fadeIn: 0.2,
  fadeOut: 0.5,
};

const fist_pump: Recipe = {
  name: 'fist_pump',
  bones: [
    // Right arm pumps up
    {
      bone: 'rightUpperArm',
      primitives: [
        { kind: 'recoil', axis: 'z', peakAngle: -1.5, settleAngle: -1.0, attackTime: 0.2, settleTime: 0.3 },
      ],
    },
    {
      bone: 'rightLowerArm',
      primitives: [
        { kind: 'recoil', axis: 'x', peakAngle: -1.2, settleAngle: -0.8, attackTime: 0.15, settleTime: 0.3 },
      ],
    },
    // Body lean into it
    {
      bone: 'chest',
      primitives: [
        { kind: 'recoil', axis: 'x', peakAngle: -0.06, settleAngle: 0, attackTime: 0.2, settleTime: 0.4 },
      ],
    },
  ],
  loop: false,
  duration: 1.5,
  fadeIn: 0.1,
  fadeOut: 0.4,
};

const dismissive: Recipe = {
  name: 'dismissive',
  bones: [
    // Backhand wave
    {
      bone: 'rightUpperArm',
      primitives: [
        { kind: 'reach', axis: 'z', target: -0.4, duration: 0.3 },
      ],
    },
    {
      bone: 'rightLowerArm',
      primitives: [
        { kind: 'reach', axis: 'x', target: -0.5, duration: 0.25 },
      ],
    },
    {
      bone: 'rightHand',
      primitives: [
        { kind: 'recoil', axis: 'y', peakAngle: 0.5, settleAngle: 0.2, attackTime: 0.2, settleTime: 0.4 },
      ],
    },
    // Head turns away
    {
      bone: 'head',
      primitives: [
        { kind: 'reach', axis: 'y', target: -0.12, duration: 0.3 },
      ],
    },
    {
      bone: 'chest',
      primitives: [
        { kind: 'reach', axis: 'y', target: -0.04, duration: 0.4 },
      ],
    },
  ],
  loop: false,
  duration: 2.0,
  fadeIn: 0.2,
  fadeOut: 0.6,
};

const plotting: Recipe = {
  name: 'plotting',
  bones: [
    // Hands together, fingers steepled
    {
      bone: 'rightUpperArm',
      primitives: [
        { kind: 'reach', axis: 'x', target: 0.4, duration: 0.5 },
        { kind: 'reach', axis: 'z', target: 0.15, duration: 0.5 },
      ],
    },
    {
      bone: 'leftUpperArm',
      primitives: [
        { kind: 'reach', axis: 'x', target: 0.4, duration: 0.5 },
        { kind: 'reach', axis: 'z', target: -0.15, duration: 0.5 },
      ],
    },
    {
      bone: 'rightLowerArm',
      primitives: [
        { kind: 'reach', axis: 'x', target: -1.0, duration: 0.4 },
      ],
    },
    {
      bone: 'leftLowerArm',
      primitives: [
        { kind: 'reach', axis: 'x', target: -1.0, duration: 0.4 },
      ],
    },
    // Slow menacing sway
    {
      bone: 'chest',
      primitives: [
        { kind: 'oscillate', axis: 'y', amplitude: 0.02, period: 3.0 },
      ],
    },
    {
      bone: 'head',
      primitives: [
        { kind: 'reach', axis: 'x', target: 0.06, duration: 0.4 },
        { kind: 'noise', axis: 'y', amplitude: 0.015, speed: 0.3, seed: 40 },
      ],
    },
  ],
  loop: true,
  fadeIn: 0.5,
  fadeOut: 0.6,
};

const sarcastic: Recipe = {
  name: 'sarcastic',
  bones: [
    // Head cocked to the side, looking away
    {
      bone: 'head',
      primitives: [
        { kind: 'reach', axis: 'z', target: 0.1, duration: 0.3 },
        { kind: 'reach', axis: 'y', target: -0.1, duration: 0.35 },
      ],
    },
    // Slight lean back
    {
      bone: 'chest',
      primitives: [
        { kind: 'reach', axis: 'x', target: -0.04, duration: 0.4 },
      ],
    },
    // One hand on hip
    {
      bone: 'leftUpperArm',
      primitives: [
        { kind: 'reach', axis: 'z', target: 0.5, duration: 0.4 },
      ],
    },
    {
      bone: 'leftLowerArm',
      primitives: [
        { kind: 'reach', axis: 'x', target: -1.2, duration: 0.35 },
      ],
    },
  ],
  loop: true,
  fadeIn: 0.3,
  fadeOut: 0.5,
};

const looking_around: Recipe = {
  name: 'looking_around',
  bones: [
    {
      bone: 'head',
      primitives: [
        { kind: 'oscillate', axis: 'y', amplitude: 0.2, period: 3.0 },
        { kind: 'oscillate', axis: 'x', amplitude: 0.05, period: 2.2, phase: 1.0 },
      ],
    },
    {
      bone: 'neck',
      primitives: [
        { kind: 'oscillate', axis: 'y', amplitude: 0.08, period: 3.0, phase: 0.3 },
      ],
    },
    {
      bone: 'chest',
      primitives: [
        { kind: 'oscillate', axis: 'y', amplitude: 0.04, period: 4.0 },
      ],
    },
  ],
  loop: true,
  fadeIn: 0.4,
  fadeOut: 0.5,
};

const shading_eyes: Recipe = {
  name: 'shading_eyes',
  bones: [
    // Right hand above eyes
    {
      bone: 'rightUpperArm',
      primitives: [
        { kind: 'reach', axis: 'x', target: -0.2, duration: 0.4 },
        { kind: 'reach', axis: 'z', target: -1.0, duration: 0.4 },
      ],
    },
    {
      bone: 'rightLowerArm',
      primitives: [
        { kind: 'reach', axis: 'x', target: -1.4, duration: 0.35 },
      ],
    },
    {
      bone: 'rightHand',
      primitives: [
        { kind: 'reach', axis: 'x', target: 0.3, duration: 0.3 },
      ],
    },
    // Head tilted up slightly, squinting
    {
      bone: 'head',
      primitives: [
        { kind: 'reach', axis: 'x', target: -0.06, duration: 0.3 },
        { kind: 'noise', axis: 'y', amplitude: 0.03, speed: 0.2, seed: 50 },
      ],
    },
  ],
  loop: true,
  fadeIn: 0.4,
  fadeOut: 0.6,
};

const telling_secret: Recipe = {
  name: 'telling_secret',
  bones: [
    // Lean in, hand near mouth
    {
      bone: 'chest',
      primitives: [
        { kind: 'reach', axis: 'x', target: 0.08, duration: 0.4 },
        { kind: 'reach', axis: 'y', target: 0.06, duration: 0.4 },
      ],
    },
    {
      bone: 'rightUpperArm',
      primitives: [
        { kind: 'reach', axis: 'x', target: 0.4, duration: 0.35 },
        { kind: 'reach', axis: 'z', target: 0.1, duration: 0.35 },
      ],
    },
    {
      bone: 'rightLowerArm',
      primitives: [
        { kind: 'reach', axis: 'x', target: -1.3, duration: 0.3 },
      ],
    },
    {
      bone: 'head',
      primitives: [
        { kind: 'reach', axis: 'y', target: 0.1, duration: 0.3 },
        { kind: 'reach', axis: 'x', target: 0.04, duration: 0.3 },
      ],
    },
  ],
  loop: true,
  fadeIn: 0.4,
  fadeOut: 0.5,
};

const victory: Recipe = {
  name: 'victory',
  bones: [
    // Both arms up!
    {
      bone: 'rightUpperArm',
      primitives: [
        { kind: 'recoil', axis: 'z', peakAngle: -1.6, settleAngle: -1.3, attackTime: 0.25, settleTime: 0.4 },
      ],
    },
    {
      bone: 'leftUpperArm',
      primitives: [
        { kind: 'recoil', axis: 'z', peakAngle: 1.6, settleAngle: 1.3, attackTime: 0.25, settleTime: 0.4 },
      ],
    },
    {
      bone: 'rightLowerArm',
      primitives: [
        { kind: 'reach', axis: 'x', target: -0.4, duration: 0.3 },
      ],
    },
    {
      bone: 'leftLowerArm',
      primitives: [
        { kind: 'reach', axis: 'x', target: -0.4, duration: 0.3 },
      ],
    },
    // Triumphant lean back
    {
      bone: 'chest',
      primitives: [
        { kind: 'recoil', axis: 'x', peakAngle: -0.1, settleAngle: -0.04, attackTime: 0.25, settleTime: 0.5 },
      ],
    },
    {
      bone: 'head',
      primitives: [
        { kind: 'reach', axis: 'x', target: -0.08, duration: 0.3 },
      ],
    },
  ],
  loop: false,
  duration: 3.0,
  fadeIn: 0.15,
  fadeOut: 0.6,
};

const head_shake: Recipe = {
  name: 'head_shake',
  bones: [
    {
      bone: 'head',
      primitives: [
        { kind: 'oscillate', axis: 'y', amplitude: 0.15, period: 0.5 },
      ],
    },
    {
      bone: 'neck',
      primitives: [
        { kind: 'oscillate', axis: 'y', amplitude: 0.05, period: 0.5, phase: 0.2 },
      ],
    },
  ],
  loop: false,
  duration: 1.8,
  fadeIn: 0.15,
  fadeOut: 0.4,
};

const relief: Recipe = {
  name: 'relief',
  bones: [
    // Big exhale — shoulders drop, head tilts back then forward
    {
      bone: 'leftShoulder',
      primitives: [
        { kind: 'recoil', axis: 'z', peakAngle: 0.08, settleAngle: -0.03, attackTime: 0.3, settleTime: 0.8 },
      ],
    },
    {
      bone: 'rightShoulder',
      primitives: [
        { kind: 'recoil', axis: 'z', peakAngle: -0.08, settleAngle: 0.03, attackTime: 0.3, settleTime: 0.8 },
      ],
    },
    {
      bone: 'head',
      primitives: [
        { kind: 'recoil', axis: 'x', peakAngle: -0.1, settleAngle: 0.03, attackTime: 0.4, settleTime: 0.6 },
      ],
    },
    {
      bone: 'chest',
      primitives: [
        { kind: 'recoil', axis: 'x', peakAngle: -0.05, settleAngle: 0.02, attackTime: 0.3, settleTime: 0.7 },
      ],
    },
  ],
  loop: false,
  duration: 2.5,
  fadeIn: 0.2,
  fadeOut: 0.6,
};

const cautious_agree: Recipe = {
  name: 'cautious_agree',
  bones: [
    // Slight step back (lean back), then reluctant nod
    {
      bone: 'chest',
      primitives: [
        { kind: 'recoil', axis: 'x', peakAngle: -0.08, settleAngle: -0.02, attackTime: 0.3, settleTime: 0.5 },
      ],
    },
    {
      bone: 'head',
      primitives: [
        { kind: 'reach', axis: 'x', target: 0.06, duration: 0.6, delay: 0.4 },
        { kind: 'reach', axis: 'z', target: 0.04, duration: 0.5 },
      ],
    },
  ],
  loop: false,
  duration: 2.0,
  fadeIn: 0.2,
  fadeOut: 0.5,
};

const angry_fist: Recipe = {
  name: 'angry_fist',
  bones: [
    // Fist shake
    {
      bone: 'rightUpperArm',
      primitives: [
        { kind: 'reach', axis: 'x', target: 0.3, duration: 0.2 },
        { kind: 'reach', axis: 'z', target: -0.5, duration: 0.2 },
      ],
    },
    {
      bone: 'rightLowerArm',
      primitives: [
        { kind: 'reach', axis: 'x', target: -1.2, duration: 0.2 },
        { kind: 'oscillate', axis: 'x', amplitude: 0.1, period: 0.25 },
      ],
    },
    // Body tense
    {
      bone: 'chest',
      primitives: [
        { kind: 'reach', axis: 'x', target: 0.06, duration: 0.3 },
      ],
    },
    {
      bone: 'head',
      primitives: [
        { kind: 'reach', axis: 'x', target: 0.08, duration: 0.25 },
      ],
    },
  ],
  loop: false,
  duration: 2.0,
  fadeIn: 0.15,
  fadeOut: 0.5,
};

const rallying: Recipe = {
  name: 'rallying',
  bones: [
    // Both arms up, pumping
    {
      bone: 'rightUpperArm',
      primitives: [
        { kind: 'reach', axis: 'z', target: -1.2, duration: 0.3 },
        { kind: 'oscillate', axis: 'z', amplitude: 0.15, period: 0.6 },
      ],
    },
    {
      bone: 'leftUpperArm',
      primitives: [
        { kind: 'reach', axis: 'z', target: 1.2, duration: 0.3 },
        { kind: 'oscillate', axis: 'z', amplitude: 0.15, period: 0.6, phase: Math.PI },
      ],
    },
    {
      bone: 'rightLowerArm',
      primitives: [
        { kind: 'reach', axis: 'x', target: -0.6, duration: 0.25 },
      ],
    },
    {
      bone: 'leftLowerArm',
      primitives: [
        { kind: 'reach', axis: 'x', target: -0.6, duration: 0.25 },
      ],
    },
    // Energetic bounce
    {
      bone: 'chest',
      primitives: [
        { kind: 'oscillate', axis: 'x', amplitude: 0.04, period: 0.6 },
      ],
    },
  ],
  loop: false,
  duration: 3.0,
  fadeIn: 0.2,
  fadeOut: 0.5,
};

const sad_idle: Recipe = {
  name: 'sad_idle',
  bones: [
    // Drooped posture
    {
      bone: 'head',
      primitives: [
        { kind: 'reach', axis: 'x', target: 0.12, duration: 0.6 },
        { kind: 'noise', axis: 'y', amplitude: 0.01, speed: 0.15, seed: 60 },
      ],
    },
    {
      bone: 'chest',
      primitives: [
        { kind: 'reach', axis: 'x', target: 0.06, duration: 0.8 },
      ],
    },
    {
      bone: 'leftShoulder',
      primitives: [
        { kind: 'reach', axis: 'z', target: 0.06, duration: 0.7 },
      ],
    },
    {
      bone: 'rightShoulder',
      primitives: [
        { kind: 'reach', axis: 'z', target: -0.06, duration: 0.7 },
      ],
    },
    // Arms hanging more limply
    {
      bone: 'leftUpperArm',
      primitives: [
        { kind: 'reach', axis: 'x', target: 0.05, duration: 0.6 },
      ],
    },
    {
      bone: 'rightUpperArm',
      primitives: [
        { kind: 'reach', axis: 'x', target: 0.05, duration: 0.6 },
      ],
    },
  ],
  loop: true,
  fadeIn: 0.6,
  fadeOut: 0.8,
};

const nervous_look: Recipe = {
  name: 'nervous_look',
  bones: [
    // Quick darting head movements
    {
      bone: 'head',
      primitives: [
        { kind: 'oscillate', axis: 'y', amplitude: 0.12, period: 1.5 },
        { kind: 'noise', axis: 'x', amplitude: 0.03, speed: 1.5, seed: 70 },
      ],
    },
    // Shoulders tense
    {
      bone: 'leftShoulder',
      primitives: [
        { kind: 'reach', axis: 'z', target: 0.05, duration: 0.3 },
        { kind: 'oscillate', axis: 'z', amplitude: 0.02, period: 2.0 },
      ],
    },
    {
      bone: 'rightShoulder',
      primitives: [
        { kind: 'reach', axis: 'z', target: -0.05, duration: 0.3 },
        { kind: 'oscillate', axis: 'z', amplitude: 0.02, period: 2.0, phase: Math.PI },
      ],
    },
  ],
  loop: true,
  fadeIn: 0.2,
  fadeOut: 0.4,
};

const terrified: Recipe = {
  name: 'terrified',
  bones: [
    // Recoil — lean back, arms up defensively
    {
      bone: 'chest',
      primitives: [
        { kind: 'recoil', axis: 'x', peakAngle: -0.15, settleAngle: -0.08, attackTime: 0.15, settleTime: 0.4 },
      ],
    },
    {
      bone: 'rightUpperArm',
      primitives: [
        { kind: 'reach', axis: 'x', target: 0.3, duration: 0.2 },
        { kind: 'reach', axis: 'z', target: -0.4, duration: 0.2 },
      ],
    },
    {
      bone: 'leftUpperArm',
      primitives: [
        { kind: 'reach', axis: 'x', target: 0.3, duration: 0.2 },
        { kind: 'reach', axis: 'z', target: 0.4, duration: 0.2 },
      ],
    },
    {
      bone: 'rightLowerArm',
      primitives: [
        { kind: 'reach', axis: 'x', target: -0.8, duration: 0.2 },
      ],
    },
    {
      bone: 'leftLowerArm',
      primitives: [
        { kind: 'reach', axis: 'x', target: -0.8, duration: 0.2 },
      ],
    },
    // Trembling
    {
      bone: 'head',
      primitives: [
        { kind: 'reach', axis: 'x', target: -0.06, duration: 0.15 },
        { kind: 'oscillate', axis: 'x', amplitude: 0.015, period: 0.12 },
        { kind: 'oscillate', axis: 'y', amplitude: 0.01, period: 0.15 },
      ],
    },
  ],
  loop: true,
  fadeIn: 0.1,
  fadeOut: 0.5,
};

const scratching_head: Recipe = {
  name: 'scratching_head',
  bones: [
    // Right hand reaches head
    {
      bone: 'rightUpperArm',
      primitives: [
        { kind: 'reach', axis: 'x', target: -0.2, duration: 0.4 },
        { kind: 'reach', axis: 'z', target: -0.8, duration: 0.4 },
      ],
    },
    {
      bone: 'rightLowerArm',
      primitives: [
        { kind: 'reach', axis: 'x', target: -1.5, duration: 0.35 },
      ],
    },
    // Scratching motion
    {
      bone: 'rightHand',
      primitives: [
        { kind: 'oscillate', axis: 'x', amplitude: 0.08, period: 0.3 },
      ],
    },
    // Head tilts into the scratch
    {
      bone: 'head',
      primitives: [
        { kind: 'reach', axis: 'z', target: 0.08, duration: 0.4 },
      ],
    },
  ],
  loop: true,
  fadeIn: 0.3,
  fadeOut: 0.5,
};

const cocky: Recipe = {
  name: 'cocky',
  bones: [
    // Lean back, chest out
    {
      bone: 'chest',
      primitives: [
        { kind: 'reach', axis: 'x', target: -0.06, duration: 0.4 },
      ],
    },
    {
      bone: 'head',
      primitives: [
        { kind: 'reach', axis: 'x', target: -0.04, duration: 0.3 },
        { kind: 'reach', axis: 'z', target: 0.06, duration: 0.35 },
      ],
    },
    // Hand on hip
    {
      bone: 'leftUpperArm',
      primitives: [
        { kind: 'reach', axis: 'z', target: 0.5, duration: 0.4 },
      ],
    },
    {
      bone: 'leftLowerArm',
      primitives: [
        { kind: 'reach', axis: 'x', target: -1.3, duration: 0.35 },
      ],
    },
    // Subtle sway
    {
      bone: 'spine',
      primitives: [
        { kind: 'oscillate', axis: 'z', amplitude: 0.01, period: 3.5 },
      ],
    },
  ],
  loop: true,
  fadeIn: 0.3,
  fadeOut: 0.5,
};

const questioning: Recipe = {
  name: 'questioning',
  bones: [
    // One hand raised, palm up
    {
      bone: 'rightUpperArm',
      primitives: [
        { kind: 'reach', axis: 'x', target: 0.4, duration: 0.35 },
        { kind: 'reach', axis: 'z', target: -0.5, duration: 0.35 },
      ],
    },
    {
      bone: 'rightLowerArm',
      primitives: [
        { kind: 'reach', axis: 'x', target: -0.6, duration: 0.3 },
      ],
    },
    {
      bone: 'rightHand',
      primitives: [
        { kind: 'reach', axis: 'x', target: -0.3, duration: 0.3 },
      ],
    },
    // Head tilted
    {
      bone: 'head',
      primitives: [
        { kind: 'reach', axis: 'z', target: 0.1, duration: 0.3 },
        { kind: 'reach', axis: 'x', target: 0.03, duration: 0.35 },
      ],
    },
    // Slight lean
    {
      bone: 'chest',
      primitives: [
        { kind: 'reach', axis: 'x', target: 0.03, duration: 0.4 },
      ],
    },
  ],
  loop: true,
  fadeIn: 0.3,
  fadeOut: 0.5,
};

const phone: Recipe = {
  name: 'phone',
  bones: [
    // Right hand to ear
    {
      bone: 'rightUpperArm',
      primitives: [
        { kind: 'reach', axis: 'x', target: 0.1, duration: 0.4 },
        { kind: 'reach', axis: 'z', target: -0.9, duration: 0.4 },
      ],
    },
    {
      bone: 'rightLowerArm',
      primitives: [
        { kind: 'reach', axis: 'x', target: -1.6, duration: 0.35 },
      ],
    },
    // Head tilts toward phone
    {
      bone: 'head',
      primitives: [
        { kind: 'reach', axis: 'z', target: -0.08, duration: 0.3 },
        { kind: 'noise', axis: 'x', amplitude: 0.015, speed: 0.4, seed: 80 },
      ],
    },
    // Slight pacing sway
    {
      bone: 'spine',
      primitives: [
        { kind: 'oscillate', axis: 'y', amplitude: 0.015, period: 4.0 },
      ],
    },
  ],
  loop: true,
  fadeIn: 0.4,
  fadeOut: 0.5,
};

const celebrating: Recipe = {
  name: 'celebrating',
  bones: [
    // Arms pumping alternately
    {
      bone: 'rightUpperArm',
      primitives: [
        { kind: 'reach', axis: 'z', target: -1.3, duration: 0.2 },
        { kind: 'oscillate', axis: 'z', amplitude: 0.2, period: 0.5 },
      ],
    },
    {
      bone: 'leftUpperArm',
      primitives: [
        { kind: 'reach', axis: 'z', target: 1.3, duration: 0.2 },
        { kind: 'oscillate', axis: 'z', amplitude: 0.2, period: 0.5, phase: Math.PI },
      ],
    },
    {
      bone: 'rightLowerArm',
      primitives: [
        { kind: 'reach', axis: 'x', target: -0.5, duration: 0.2 },
      ],
    },
    {
      bone: 'leftLowerArm',
      primitives: [
        { kind: 'reach', axis: 'x', target: -0.5, duration: 0.2 },
      ],
    },
    // Bouncy body
    {
      bone: 'chest',
      primitives: [
        { kind: 'oscillate', axis: 'x', amplitude: 0.05, period: 0.5 },
      ],
    },
    {
      bone: 'head',
      primitives: [
        { kind: 'reach', axis: 'x', target: -0.06, duration: 0.2 },
        { kind: 'oscillate', axis: 'x', amplitude: 0.03, period: 0.5, phase: 0.5 },
      ],
    },
  ],
  loop: false,
  duration: 3.5,
  fadeIn: 0.15,
  fadeOut: 0.6,
};

// ─── Registry ─────────────────────────────────────────────────────────────────

export const RECIPES: Record<Action, Recipe> = {
  idle,
  talking,
  typing,
  nodding,
  waving,
  greeting,
  laughing,
  pointing,
  fist_pump,
  dismissive,
  plotting,
  sarcastic,
  looking_around,
  shading_eyes,
  telling_secret,
  victory,
  head_shake,
  relief,
  cautious_agree,
  angry_fist,
  rallying,
  sad_idle,
  nervous_look,
  terrified,
  scratching_head,
  cocky,
  questioning,
  phone,
  celebrating,
};
