/**
 * Generate clips.json from the current hardcoded clip-map.ts data.
 * Run once to bootstrap the JSON registry, then clip-map.ts can be deleted.
 *
 * Usage: npx tsx scripts/generate-clips-json.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const animDir = resolve(__dirname, '../web/public/animations');
const outPath = resolve(__dirname, '../web/src/data/clips.json');

// ─── Inline copy of clip-map data (to avoid import issues with .ts) ──────────

interface ClipEntry {
  file: string;
  weight: number;
  loop: boolean;
  fadeIn?: number;
  fadeOut?: number;
}

interface ActionMapping {
  primary: ClipEntry;
  layers?: ClipEntry[];
  duration?: number;
}

interface EmotionModifier {
  overrides?: Record<string, ClipEntry>;
  layers?: ClipEntry[];
  weightScale?: number;
}

const ACTION_CLIPS: Record<string, ActionMapping> = {
  idle: {
    primary: { file: 'female-standing-idle.fbx', weight: 1.0, loop: true, fadeIn: 0.5, fadeOut: 0.5 },
  },
  talking: {
    primary: { file: 'happy-forward-hand-gesture.fbx', weight: 0.85, loop: true, fadeIn: 0.3, fadeOut: 0.5 },
    layers: [{ file: 'nodding-head-yes.fbx', weight: 0.2, loop: true }],
  },
  typing: {
    primary: { file: 'sitting-at-a-computer-and-typing.fbx', weight: 1.0, loop: true, fadeIn: 0.4, fadeOut: 0.6 },
  },
  nodding: {
    primary: { file: 'nodding-head-yes.fbx', weight: 1.0, loop: false, fadeIn: 0.15, fadeOut: 0.4 },
    duration: 1.8,
  },
  waving: {
    primary: { file: 'emotional-waving-forward.fbx', weight: 1.0, loop: false, fadeIn: 0.2, fadeOut: 0.5 },
    duration: 2.5,
  },
  greeting: {
    primary: { file: 'greeting-while-standing.fbx', weight: 1.0, loop: false, fadeIn: 0.2, fadeOut: 0.6 },
    duration: 2.5,
  },
  laughing: {
    primary: { file: 'talking-finding-something-funny.fbx', weight: 1.0, loop: false, fadeIn: 0.15, fadeOut: 0.6 },
    duration: 3.0,
  },
  pointing: {
    primary: { file: 'pointing-behind-with-thumb.fbx', weight: 1.0, loop: false, fadeIn: 0.2, fadeOut: 0.5 },
    duration: 2.0,
  },
  fist_pump: {
    primary: { file: 'high-enthusiasm-fist-pump.fbx', weight: 1.0, loop: false, fadeIn: 0.1, fadeOut: 0.4 },
    duration: 2.0,
  },
  dismissive: {
    primary: { file: 'dismissing-with-back-hand.fbx', weight: 1.0, loop: false, fadeIn: 0.2, fadeOut: 0.6 },
    duration: 2.0,
  },
  plotting: {
    primary: { file: 'evil-plotting.fbx', weight: 1.0, loop: true, fadeIn: 0.5, fadeOut: 0.6 },
  },
  sarcastic: {
    primary: { file: 'sarcastically-looking-away.fbx', weight: 1.0, loop: true, fadeIn: 0.3, fadeOut: 0.5 },
  },
  looking_around: {
    primary: { file: 'standing-up-and-looking-around.fbx', weight: 1.0, loop: true, fadeIn: 0.4, fadeOut: 0.5 },
  },
  shading_eyes: {
    primary: { file: 'looking-with-hand-shading-eyes.fbx', weight: 1.0, loop: true, fadeIn: 0.4, fadeOut: 0.6 },
  },
  telling_secret: {
    primary: { file: 'telling-a-secret.fbx', weight: 1.0, loop: true, fadeIn: 0.4, fadeOut: 0.5 },
  },
  victory: {
    primary: { file: 'big-vegas-victory-idle.fbx', weight: 1.0, loop: false, fadeIn: 0.15, fadeOut: 0.6 },
    duration: 3.0,
  },
  head_shake: {
    primary: { file: 'gesturing-head-side-to-side.fbx', weight: 1.0, loop: false, fadeIn: 0.15, fadeOut: 0.4 },
    duration: 1.8,
  },
  relief: {
    primary: { file: 'shaking-it-off-in-relief.fbx', weight: 1.0, loop: false, fadeIn: 0.2, fadeOut: 0.6 },
    duration: 2.5,
  },
  cautious_agree: {
    primary: { file: 'step-back-cautiously-agreeing.fbx', weight: 1.0, loop: false, fadeIn: 0.2, fadeOut: 0.5 },
    duration: 2.0,
  },
  angry_fist: {
    primary: { file: 'vexed-shaking-of-the-fist.fbx', weight: 1.0, loop: false, fadeIn: 0.15, fadeOut: 0.5 },
    duration: 2.0,
  },
  rallying: {
    primary: { file: 'rallying-the-crowd-to-make-them-cheer.fbx', weight: 1.0, loop: false, fadeIn: 0.2, fadeOut: 0.5 },
    duration: 3.0,
  },
  sad: {
    primary: { file: 'standing-in-a-sad-disposition.fbx', weight: 1.0, loop: true, fadeIn: 0.6, fadeOut: 0.8 },
  },
  nervous_look: {
    primary: { file: 'nervously-looking-around-left-to-right-loop.fbx', weight: 1.0, loop: true, fadeIn: 0.2, fadeOut: 0.4 },
  },
  terrified: {
    primary: { file: 'being-terrified-while-standing.fbx', weight: 1.0, loop: true, fadeIn: 0.1, fadeOut: 0.5 },
  },
  scratching_head: {
    primary: { file: 'right-hand-behind-head.fbx', weight: 1.0, loop: true, fadeIn: 0.3, fadeOut: 0.5 },
  },
  cocky: {
    primary: { file: 'cocky-lean-back.fbx', weight: 1.0, loop: true, fadeIn: 0.3, fadeOut: 0.5 },
  },
  questioning: {
    primary: { file: 'asking-a-question-with-one-hand.fbx', weight: 1.0, loop: true, fadeIn: 0.3, fadeOut: 0.5 },
  },
  phone: {
    primary: { file: 'female-standing-talking-on-phone.fbx', weight: 1.0, loop: true, fadeIn: 0.4, fadeOut: 0.5 },
  },
  celebrating: {
    primary: { file: 'restrained-enthusiasm-standing-fist-pump.fbx', weight: 1.0, loop: false, fadeIn: 0.15, fadeOut: 0.6 },
    duration: 3.5,
  },
};

const EMOTION_MODIFIERS: Record<string, EmotionModifier> = {
  happy: { weightScale: 1.1 },
  sad: {
    weightScale: 0.7,
    overrides: {
      idle: { file: 'standing-in-a-sad-disposition.fbx', weight: 0.8, loop: true, fadeIn: 0.6, fadeOut: 0.8 },
    },
  },
  excited: { weightScale: 1.2 },
  angry: { weightScale: 1.15 },
  nervous: {
    weightScale: 0.85,
    layers: [{ file: 'quick-nervous-look-over-right-shoulder.fbx', weight: 0.15, loop: true }],
  },
  relaxed: { weightScale: 0.8 },
  confused: {
    overrides: {
      idle: { file: 'looking-forward.fbx', weight: 0.9, loop: true, fadeIn: 0.4, fadeOut: 0.5 },
    },
  },
  bashful: {
    overrides: {
      idle: { file: 'being-bashful-while-standing.fbx', weight: 1.0, loop: true, fadeIn: 0.4, fadeOut: 0.6 },
    },
  },
  thinking: {
    overrides: {
      idle: { file: 'looking-off-into-the-distance.fbx', weight: 0.9, loop: true, fadeIn: 0.4, fadeOut: 0.5 },
    },
  },
  surprised: { weightScale: 1.1 },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fileToId(file: string): string {
  return file.replace('.fbx', '');
}

function inferCategory(id: string, mapping: ActionMapping | null): string {
  if (!mapping) return 'gesture'; // orphan, default
  if (id.includes('idle') || id.includes('standing-idle')) return 'idle';
  if (mapping.primary.loop && !mapping.duration) return 'continuous';
  if (mapping.duration && mapping.duration <= 2.0) return 'reaction';
  return 'gesture';
}

function inferEnergy(id: string, mapping: ActionMapping | null): string {
  const low = ['idle', 'sad', 'relaxed', 'bashful', 'looking', 'scratching'];
  const high = ['fist', 'celebrating', 'victory', 'rallying', 'terrified', 'enthusias'];
  if (low.some(k => id.includes(k))) return 'low';
  if (high.some(k => id.includes(k))) return 'high';
  return 'medium';
}

function inferBodyParts(id: string): string[] {
  const parts: string[] = [];
  if (id.includes('hand') || id.includes('fist') || id.includes('waving') || id.includes('pointing') || id.includes('phone')) parts.push('arms');
  if (id.includes('head') || id.includes('nodding') || id.includes('looking') || id.includes('shading')) parts.push('head');
  if (id.includes('standing') || id.includes('idle') || id.includes('lean')) parts.push('torso');
  if (id.includes('step') || id.includes('walk')) parts.push('legs');
  if (parts.length === 0) parts.push('full');
  return parts;
}

function inferTags(id: string): string[] {
  const tags: string[] = [];
  if (id.includes('happy') || id.includes('victory') || id.includes('celebrat') || id.includes('enthusiasm')) tags.push('positive');
  if (id.includes('sad') || id.includes('nervous') || id.includes('terrified')) tags.push('negative');
  if (id.includes('idle') || id.includes('standing')) tags.push('neutral');
  if (id.includes('secret') || id.includes('plotting')) tags.push('sneaky');
  if (id.includes('laugh') || id.includes('funny') || id.includes('cocky') || id.includes('sarcastic')) tags.push('playful');
  if (id.includes('angry') || id.includes('vexed') || id.includes('dismissing')) tags.push('aggressive');
  if (tags.length === 0) tags.push('neutral');
  return tags;
}

// ─── Generate ────────────────────────────────────────────────────────────────

// Collect all referenced FBX files
const referencedFiles = new Set<string>();
for (const m of Object.values(ACTION_CLIPS)) {
  referencedFiles.add(m.primary.file);
  if (m.layers) m.layers.forEach(l => referencedFiles.add(l.file));
}
for (const m of Object.values(EMOTION_MODIFIERS)) {
  if (m.overrides) Object.values(m.overrides).forEach(o => referencedFiles.add(o.file));
  if (m.layers) m.layers.forEach(l => referencedFiles.add(l.file));
}

// Scan disk for all FBX files
const diskFiles = readdirSync(animDir).filter(f => f.endsWith('.fbx'));

// Build clips section — all FBX on disk
const clips: Record<string, any> = {};
for (const file of diskFiles) {
  const id = fileToId(file);

  // Find if this file is used as a primary clip for any action
  let primaryAction: ActionMapping | null = null;
  for (const mapping of Object.values(ACTION_CLIPS)) {
    if (mapping.primary.file === file) {
      primaryAction = mapping;
      break;
    }
  }

  const entry = primaryAction?.primary;

  clips[id] = {
    file,
    loop: entry?.loop ?? false,
    mustFinish: false,
    returnToIdle: entry ? !entry.loop : true,
    minPlayTime: 0,
    fadeIn: entry?.fadeIn ?? 0.3,
    fadeOut: entry?.fadeOut ?? 0.5,
    category: inferCategory(id, primaryAction),
    energy: inferEnergy(id, primaryAction),
    bodyParts: inferBodyParts(id),
    symmetric: true,
    layerPriority: 0,
    additiveCompatible: !primaryAction || !!primaryAction.layers,
    baseOnly: false,
    tags: inferTags(id),
    incompatibleWith: [],
  };
}

// Build actions section
const actions: Record<string, any> = {};
for (const [name, mapping] of Object.entries(ACTION_CLIPS)) {
  actions[name] = {
    primary: {
      clip: fileToId(mapping.primary.file),
      weight: mapping.primary.weight,
    },
    layers: (mapping.layers ?? []).map(l => ({
      clip: fileToId(l.file),
      weight: l.weight,
    })),
    durationOverride: mapping.duration ?? null,
  };
}

// Build emotions section
const emotions: Record<string, any> = {};
for (const [name, mod] of Object.entries(EMOTION_MODIFIERS)) {
  const overrides: Record<string, any> = {};
  if (mod.overrides) {
    for (const [action, entry] of Object.entries(mod.overrides)) {
      overrides[action] = {
        clip: fileToId(entry.file),
        weight: entry.weight,
      };
    }
  }

  emotions[name] = {
    weightScale: mod.weightScale ?? 1.0,
    overrides,
    layers: (mod.layers ?? []).map(l => ({
      clip: fileToId(l.file),
      weight: l.weight,
    })),
  };
}

// Assemble
const clipsJson = {
  version: 1,
  clips,
  actions,
  emotions,
};

// Write
mkdirSync(resolve(__dirname, '../web/src/data'), { recursive: true });
writeFileSync(outPath, JSON.stringify(clipsJson, null, 2) + '\n');

console.log(`✓ Generated ${outPath}`);
console.log(`  ${Object.keys(clips).length} clips (${diskFiles.length} on disk, ${referencedFiles.size} referenced)`);
console.log(`  ${Object.keys(actions).length} actions`);
console.log(`  ${Object.keys(emotions).length} emotions`);
console.log(`  ${diskFiles.length - referencedFiles.size} orphaned clips on disk`);
