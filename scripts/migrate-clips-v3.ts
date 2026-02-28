/**
 * Migrate clips.json from v2 → v3 (animation groups).
 *
 * v2: actions have `clips[]`
 * v3: actions have `groups[]`, each group has `rarity` + `clips[]`
 *
 * Single-group actions get rarity: 1.
 * Idle gets multiple groups from existing idle clips in the registry.
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const clipsPath = resolve(__dirname, '../web/src/data/clips.json');

const raw = JSON.parse(readFileSync(clipsPath, 'utf-8'));

if (raw.version >= 3) {
  console.log('Already v3, skipping migration.');
  process.exit(0);
}

// Collect idle-category clips for idle group variety
const idleClipIds = Object.entries(raw.clips)
  .filter(([_, c]: [string, any]) => c.category === 'idle')
  .map(([id]) => id);

console.log(`Found ${idleClipIds.length} idle clips:`, idleClipIds);

const v3: any = {
  version: 3,
  clips: raw.clips,
  actions: {},
  emotions: raw.emotions,
};

for (const [name, action] of Object.entries(raw.actions) as [string, any][]) {
  if (name === 'idle') {
    // Build groups from idle clips
    const groups: any[] = [];
    const primaryClipId = action.clips[0]?.clip;

    for (const clipId of idleClipIds) {
      const isPrimary = clipId === primaryClipId;
      groups.push({
        rarity: isPrimary ? 0.5 : (0.5 / (idleClipIds.length - 1 || 1)),
        clips: [{
          clip: clipId,
          weight: 1,
          bodyParts: ['head', 'torso', 'arms', 'legs'],
        }],
      });
    }

    v3.actions[name] = {
      groups,
      durationOverride: action.durationOverride,
    };
  } else {
    // Wrap existing clips[] into a single group
    v3.actions[name] = {
      groups: [{
        rarity: 1,
        clips: action.clips,
      }],
      durationOverride: action.durationOverride,
    };
  }
}

writeFileSync(clipsPath, JSON.stringify(v3, null, 2) + '\n');
console.log('Migrated clips.json to v3 (animation groups).');
