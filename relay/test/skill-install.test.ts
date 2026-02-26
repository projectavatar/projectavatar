import { describe, it, expect } from 'vitest';
import { handleSkillInstall } from '../src/skill-install.js';

const VALID_TOKEN = 'a'.repeat(48);
const BASE_URL = 'https://relay.projectavatar.io';

function makeRequest(token?: string): Request {
  const url = token
    ? `${BASE_URL}/skill/install?token=${token}`
    : `${BASE_URL}/skill/install`;
  return new Request(url);
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
    expect(text).toContain('idle');
    expect(text).toContain('responding');
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
});
