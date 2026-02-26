#!/usr/bin/env node
/**
 * CLI wrapper for the avatar output filter.
 *
 * Usage (pipe mode — filters stdin to stdout):
 *   echo "[avatar:{...}] Hello" | node cli.js --relay https://... --token abc123
 *   cat response.txt | node cli.js --config filter-config.json
 *
 * The filter reads from stdin and writes clean text to stdout.
 * Avatar events are pushed to the relay in the background.
 * Errors go to stderr and never affect stdout.
 */

import { createInterface } from 'readline';
import { readFileSync } from 'fs';
import { StreamingAvatarFilter } from './streaming-filter.js';
import type { FilterConfig } from './filter.js';

// ─── Arg parsing ──────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): FilterConfig & { debug?: boolean } {
  const args = argv.slice(2);
  const config: Partial<FilterConfig> & { debug?: boolean } = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === '--relay' || arg === '-r') && args[i + 1]) {
      config.relayUrl = args[++i];
    } else if ((arg === '--token' || arg === '-t') && args[i + 1]) {
      config.token = args[++i];
    } else if ((arg === '--config' || arg === '-c') && args[i + 1]) {
      const raw = readFileSync(args[++i], 'utf-8');
      Object.assign(config, JSON.parse(raw));
    } else if (arg === '--disabled') {
      config.enabled = false;
    } else if (arg === '--debug') {
      config.debug = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  // Validate
  if (!config.relayUrl) {
    die('--relay <url> is required (or provide via --config)');
  }
  if (!config.token) {
    die('--token <token> is required (or provide via --config)');
  }

  return config as FilterConfig & { debug?: boolean };
}

function printHelp(): void {
  console.error(`
avatar-filter — strip avatar tags from agent responses and push to relay

Usage:
  echo "[avatar:...] response" | avatar-filter [options]
  cat response.txt | avatar-filter [options]

Options:
  -r, --relay <url>    Relay base URL (e.g. https://relay.projectavatar.io)
  -t, --token <token>  Your avatar token
  -c, --config <file>  JSON config file with relayUrl + token
      --disabled       Passthrough mode (strips tags but doesn't push to relay)
      --debug          Verbose stderr logging
  -h, --help           Show this help

Config file format:
  { "relayUrl": "https://...", "token": "...", "enabled": true }

Environment variables:
  AVATAR_RELAY_URL     Relay base URL (overridden by --relay flag)
  AVATAR_TOKEN         Avatar token (overridden by --token flag)
  AVATAR_DEBUG         Enable verbose logging (any non-empty value)
`.trim());
}

function die(msg: string): never {
  console.error(`[avatar-filter] Error: ${msg}`);
  console.error('Run with --help for usage.');
  process.exit(1);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  // Allow env vars as fallback config
  if (process.env.AVATAR_RELAY_URL && !process.argv.includes('--relay')) {
    process.argv.push('--relay', process.env.AVATAR_RELAY_URL);
  }
  if (process.env.AVATAR_TOKEN && !process.argv.includes('--token')) {
    process.argv.push('--token', process.env.AVATAR_TOKEN);
  }
  if (process.env.AVATAR_DEBUG) {
    process.argv.push('--debug');
  }

  const config = parseArgs(process.argv);

  if (config.debug) {
    process.env.AVATAR_DEBUG = '1';
    console.error(`[avatar-filter] relay=${config.relayUrl} token=${config.token.slice(0, 8)}... enabled=${config.enabled !== false}`);
  }

  // We need to accumulate all stdin to handle multi-line responses correctly.
  // If stdin is a large stream, the streaming filter handles it chunk by chunk.
  //
  // Strategy: line-buffer stdin, process as text chunks through StreamingAvatarFilter.
  // Each chunk is written to stdout immediately as clean text is produced.

  const filter = new StreamingAvatarFilter(config, {
    onChunk: (chunk) => {
      process.stdout.write(chunk);
    },
    onTagExtracted: (extracted) => {
      if (config.debug) {
        console.error(`[avatar-filter] tag extracted: ${extracted}`);
      }
    },
  });

  // Read stdin line by line, re-adding newlines for correct tag parsing
  const rl = createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
    terminal: false,
  });

  let firstLine = true;

  rl.on('line', (line) => {
    // Re-add the newline that readline strips
    const chunk = firstLine ? line : '\n' + line;
    firstLine = false;
    filter.processChunk(chunk);
  });

  rl.on('close', () => {
    filter.flush();
    // Ensure stdout is fully flushed before exit
    process.stdout.write('', () => process.exit(0));
  });

  rl.on('error', (err) => {
    console.error('[avatar-filter] stdin error:', err);
    filter.flush();
    process.exit(1);
  });
}

main();
