import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const deployment = readFileSync(resolve(repoRoot, 'k8s/deployment.yaml'), 'utf8');
const compose = readFileSync(resolve(repoRoot, 'infra/docker/docker-compose.devops.yml'), 'utf8');

describe('issuer webhook deployment admission', () => {
  it('requires a shared Redis endpoint and keeps issuer configuration fail-closed', () => {
    expect(deployment).toContain('name: REDIS_URL');
    expect(deployment).toContain('key: redis_url');
    expect(deployment).toContain('key: issuer_id');
    expect(deployment).toContain('key: issuer_webhook_secret');
    expect(deployment).toContain('optional: true');
  });

  it('persists local Redis idempotency records and rejects committed database passwords', () => {
    expect(compose).toContain('REDIS_URL: redis://redis:6379');
    expect(compose).toContain('--appendonly');
    expect(compose).toContain('--appendfsync", "always"');
    expect(compose).toContain('redis_data:/data');
    expect(compose).toContain('${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD}');
    expect(compose).not.toContain('POSTGRES_PASSWORD: zwallet');
  });
});
