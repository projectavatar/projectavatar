import { describe, it, expect } from 'vitest';
import { handleSkillInstall } from '../src/skill-install.js';
import { EMOTIONS, ACTIONS } from '../../packages/shared/src/schema.js';

const VALID_TOKEN = 'a'.repeat(48);
const BASE_URL = 'https://relay.projectavatar.io';

function makeRequest(token?: string, baseUrl = BASE_URL, model?: string): Request {
  const url = new URL(`${baseUrl}/skill/install`);
  if (token) url.searchParams.set('token', token);
  if (model) url.searchParams.set('model', model);
  return new Request(url.toString());
}

describe('handleSkillInstall', () => {
  it('returns 400 when token is missing', async () => {
    const res = await handleSkillInstall(makeRequest());
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/token/i);
  });

  it('returns 400 for a token that is too short', async () => {
    const res = await handleSkillInstall(makeRequest('abc'));
    expect(res.status).toBe(400);
  });

  it('returns 400 for a token with invalid characters', async () => {
    const res = await handleSkillInstall(makeRequest('!'.repeat(48)));
    expect(res.status).toBe(400);
  });

  it('returns 200 with text/markdown for a valid token', async () => {
    const res = await handleSkillInstall(makeRequest(VALID_TOKEN));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/markdown');
  });

  it('sets Cache-Control: no-store', async () => {
    const res = await handleSkillInstall(makeRequest(VALID_TOKEN));
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('sets Content-Disposition: inline with filename', async () => {
    const res = await handleSkillInstall(makeRequest(VALID_TOKEN));
    expect(res.headers.get('content-disposition')).toContain('avatar-skill.md');
  });

  it('embeds the token in the response body', async () => {
    const token = 'b'.repeat(48);
    const res = await handleSkillInstall(makeRequest(token));
    const text = await res.text();
    expect(text).toContain(token);
  });

  it('embeds the relay URL in the response body', async () => {
    const res = await handleSkillInstall(makeRequest(VALID_TOKEN));
    const text = await res.text();
    expect(text).toContain('relay.projectavatar.io');
  });

  it('includes a curl verification command with the token', async () => {
    const token = 'c'.repeat(48);
    const res = await handleSkillInstall(makeRequest(token));
    const text = await res.text();
    expect(text).toContain(`/push/${token}`);
  });

  it('includes all required avatar instructions', async () => {
    const res = await handleSkillInstall(makeRequest(VALID_TOKEN));
    const text = await res.text();
    expect(text).toContain('[avatar:');
    expect(text).toContain('emotion');
    expect(text).toContain('action');
  });

  it('returns CORS headers', async () => {
    const res = await handleSkillInstall(makeRequest(VALID_TOKEN));
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('handles token at minimum length (32 chars)', async () => {
    const res = await handleSkillInstall(makeRequest('d'.repeat(32)));
    expect(res.status).toBe(200);
  });

  it('handles token at maximum length (64 chars)', async () => {
    const res = await handleSkillInstall(makeRequest('e'.repeat(64)));
    expect(res.status).toBe(200);
  });

  it('rejects token at 65 chars', async () => {
    const res = await handleSkillInstall(makeRequest('f'.repeat(65)));
    expect(res.status).toBe(400);
  });

  // ─── Schema-derived content ──────────────────────────────────────────────

  it('lists all emotions from schema (stays in sync automatically)', async () => {
    const res = await handleSkillInstall(makeRequest(VALID_TOKEN));
    const text = await res.text();
    for (const emotion of EMOTIONS) {
      expect(text).toContain(emotion);
    }
  });

  it('lists all actions from schema (stays in sync automatically)', async () => {
    const res = await handleSkillInstall(makeRequest(VALID_TOKEN));
    const text = await res.text();
    for (const action of ACTIONS) {
      expect(text).toContain(action);
    }
  });

  // ─── avatarBase derivation ───────────────────────────────────────────────

  it('derives avatar URL from relay subdomain', async () => {
    const res = await handleSkillInstall(makeRequest(VALID_TOKEN, 'https://relay.projectavatar.io'));
    const text = await res.text();
    expect(text).toContain('avatar.projectavatar.io');
    expect(text).not.toContain('relay.projectavatar.io/?token='); // relay URL, not avatar URL for the app link
  });

  it('falls back to production avatar URL for localhost', async () => {
    const res = await handleSkillInstall(makeRequest(VALID_TOKEN, 'http://localhost:8787'));
    const text = await res.text();
    expect(text).toContain('https://avatar.projectavatar.io');
  });

  it('falls back to production avatar URL for non-relay subdomain', async () => {
    const res = await handleSkillInstall(makeRequest(VALID_TOKEN, 'https://workers.dev'));
    const text = await res.text();
    expect(text).toContain('https://avatar.projectavatar.io');
  });

  it('does not double-replace "relay" appearing elsewhere in the URL', async () => {
    // e.g. project-relay.example.com should NOT become project-avatar.example.com
    const res = await handleSkillInstall(makeRequest(VALID_TOKEN, 'https://project-relay.example.com'));
    const text = await res.text();
    // Should fall back to production, not mangle the hostname
    expect(text).toContain('https://avatar.projectavatar.io');
  });

  // ─── ?model= parameter ──────────────────────────────────────────────────

  it('includes model in avatar URL when model param is provided', async () => {
    const res = await handleSkillInstall(makeRequest(VALID_TOKEN, BASE_URL, 'maid-v1'));
    const text = await res.text();
    expect(text).toContain(`model=maid-v1`);
    expect(text).toContain(`token=${VALID_TOKEN}&model=maid-v1`);
  });

  it('omits model from avatar URL when model param is not provided', async () => {
    const res = await handleSkillInstall(makeRequest(VALID_TOKEN));
    const text = await res.text();
    expect(text).not.toContain('model=');
  });

  it('includes the "Your Avatar URL" section', async () => {
    const res = await handleSkillInstall(makeRequest(VALID_TOKEN, BASE_URL, 'placeholder'));
    const text = await res.text();
    expect(text).toContain('## Your Avatar URL');
    expect(text).toContain('avatar.projectavatar.io');
  });

  it('uses full avatar URL with model in verification section', async () => {
    const res = await handleSkillInstall(makeRequest(VALID_TOKEN, BASE_URL, 'placeholder'));
    const text = await res.text();
    // The verification section should use the same URL as "Your Avatar URL"
    const avatarUrl = `https://avatar.projectavatar.io/?token=${VALID_TOKEN}&model=placeholder`;
    // Count occurrences — should appear multiple times (Avatar URL section + verification + body text)
    const occurrences = text.split(avatarUrl).length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });
});
