#!/usr/bin/env npx tsx
/**
 * Migrate clips.json from v1 to v2 format.
 *
 * v1: actions have { primary: ClipRef, layers: ClipRef[], durationOverride }
 * v2: actions have { clips: ClipLayer[], durationOverride }
 *
 * ClipLayer = { clip, weight, bodyParts }
 * bodyParts are copied from the clip definition.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INPUT = resolve(__dirname, '../web/src/data/clips.json');
const OUTPUT = resolve(__dirname, '../web/src/data/clips.json');

interface ClipRefV1 {
  clip: string;
  weight: number;
}

interface ActionV1 {
  primary: ClipRefV1;
  layers: ClipRefV1[];
  durationOverride: number | null;
}

interface ClipLayer {
  clip: string;
  weight: number;
  bodyParts: string[];
}

interface ActionV2 {
  clips: ClipLayer[];
  durationOverride: number | null;
}

const raw = JSON.parse(readFileSync(INPUT, 'utf-8'));

if (raw.version === 2) {
  console.log('Already v2, nothing to do.');
  process.exit(0);
}

const clips: Record<string, { bodyParts: string[] }> = raw.clips;

function refToLayer(ref: ClipRefV1): ClipLayer {
  const clipData = clips[ref.clip];
  return {
    clip: ref.clip,
    weight: ref.weight,
    bodyParts: clipData?.bodyParts ?? ['head', 'torso', 'arms', 'legs'],
  };
}

const newActions: Record<string, ActionV2> = {};

for (const [name, action] of Object.entries(raw.actions as Record<string, ActionV1>)) {
  const clipLayers: ClipLayer[] = [refToLayer(action.primary)];
  for (const layer of action.layers) {
    clipLayers.push(refToLayer(layer));
  }
  newActions[name] = {
    clips: clipLayers,
    durationOverride: action.durationOverride,
  };
}

const output = {
  ...raw,
  version: 2,
  actions: newActions,
};

writeFileSync(OUTPUT, JSON.stringify(output, null, 2) + '\n');
console.log(`Migrated ${Object.keys(newActions).length} actions to v2 format.`);
console.log(`Written to ${OUTPUT}`);
