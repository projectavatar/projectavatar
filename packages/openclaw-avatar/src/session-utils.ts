/**
 * Session key utilities — priority derivation for multi-session arbitration.
 *
 * Exported as a standalone module so it can be unit-tested against the real
 * implementation rather than a copy. Internal to the plugin package.
 */

/**
 * Derive session priority from an OpenClaw sessionKey.
 *
 * OpenClaw sessionKey format: `agent:<agentId>:<rest>`
 *
 * Priority = number of ':subagent:' segments (the subagent nesting depth):
 * - Main/channel sessions → 0  (e.g. "agent:main:discord:guild-X:channel-Y")
 * - Sub-agents            → 1  (e.g. "agent:main:subagent:<uuid>")
 * - Nested sub-agents     → 2  (e.g. "agent:main:subagent:<uuid>:subagent:<uuid>")
 * - Cron sessions         → 1  (e.g. "agent:main:cron:<taskId>") — treated as background
 *
 * Cron detection: checks any colon-delimited segment for the literal "cron"
 * (case-insensitive), which is more resilient than checking only parts[2].
 *
 * Two concurrent sessions at the same priority are handled by the relay via
 * first-mover tiebreaker (firstPushAt). This function only determines the tier.
 */
export function deriveSessionPriority(sessionKey: string): number {
  const lower = sessionKey.toLowerCase();

  // Count ':subagent:' occurrences — each nesting level adds one
  let depth = 0;
  let pos   = 0;
  const marker = ':subagent:';
  while ((pos = lower.indexOf(marker, pos)) !== -1) {
    depth++;
    pos += marker.length;
  }
  if (depth > 0) return depth;

  // Cron sessions: any segment equal to "cron" → treat as background (priority 1).
  // Checking all segments is more resilient than hardcoding the position.
  const parts = lower.split(':').filter(Boolean);
  if (parts.includes('cron')) return 1;

  // Everything else is a main/channel session — priority 0
  return 0;
}
