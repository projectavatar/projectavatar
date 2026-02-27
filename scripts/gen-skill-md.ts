#!/usr/bin/env node
/**
 * scripts/gen-skill-md.ts
 *
 * Generates skill/openclaw/SKILL.md from the shared skill template.
 *
 * Usage:
 *   npx tsx scripts/gen-skill-md.ts
 *   # or via npm script:
 *   npm run gen:skill
 *
 * Run this whenever packages/shared/src/skill-template.ts changes.
 * Commit the result — SKILL.md in the repo should always reflect
 * the current template with placeholder values shown as-is.
 *
 * The generated file includes a header warning that it's auto-generated.
 * Edit the template, not this file.
 */

import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { renderSkillDoc } from '../packages/shared/src/skill-template.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '../skill/openclaw/SKILL.md');

// Render with clearly-marked placeholder values so the repo copy
// reads like a real example but is obviously not a real token.
// Frontmatter must be the very first bytes — no comment before it.
// The auto-generated notice goes as a YAML comment inside the frontmatter block.
const rendered = renderSkillDoc({
  token: 'YOUR_TOKEN_HERE',
  relayUrl: 'https://relay.projectavatar.io',
  avatarUrl: 'https://app.projectavatar.io/?token=YOUR_TOKEN_HERE',
});

// Insert the auto-gen notice as a YAML comment on the first line (after the opening ---)
const content = rendered.replace(
  /^---\n/,
  '---\n# AUTO-GENERATED — do not edit directly.\n# Source: packages/shared/src/skill-template.ts\n# Regenerate: npm run gen:skill\n',
);

writeFileSync(OUTPUT_PATH, content, 'utf-8');
console.log(`✓ Generated ${OUTPUT_PATH}`);
