import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRuntimeConfig } from '../dist/runtime-config.js';

test('ECS startup rejects an absent or blank browser audience without exposing it', () => {
  for (const ecs of [
    { ECS_CONTAINER_METADATA_URI_V4: 'http://169.254.170.2/v4/task' },
    { ECS_CONTAINER_METADATA_URI: 'http://169.254.170.2/v3/task' },
    { AWS_EXECUTION_ENV: 'AWS_ECS_FARGATE' }
  ]) {
    for (const JWT_AUDIENCE of [undefined, '', '   ']) {
      assert.throws(() => validateRuntimeConfig({ ...ecs, JWT_AUDIENCE }),
        { message: 'JWT_AUDIENCE must be nonempty for the trusted browser application' });
    }
    assert.doesNotThrow(() => validateRuntimeConfig({ ...ecs, JWT_AUDIENCE: 'browser-client' }));
  }
  assert.doesNotThrow(() => validateRuntimeConfig({}));
});
