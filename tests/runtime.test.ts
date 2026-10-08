import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FeatureController } from '../src/runtime/controller.ts';
import { DEFAULT_SETTINGS } from '../src/shared/settings.ts';
import type { Feature } from '../src/shared/types.ts';

test('navigation aborts old work, removes controls, and mounts a fresh feature', () => {
  let mounts = 0;
  let removals = 0;
  const signals: AbortSignal[] = [];
  const feature: Feature = {
    id: 'fixture', enabled: () => true, matches: () => true,
    mount: ({ signal }) => { mounts++; signals.push(signal); return () => { removals++; }; },
  };
  const controller = new FeatureController([feature]);
  controller.update(new URL('https://example.myschoolapp.com/app#one'), DEFAULT_SETTINGS);
  controller.update(new URL('https://example.myschoolapp.com/app#one'), DEFAULT_SETTINGS);
  assert.equal(mounts, 1);
  controller.update(new URL('https://example.myschoolapp.com/app#two'), DEFAULT_SETTINGS);
  assert.equal(signals[0].aborted, true);
  assert.equal(removals, 1);
  assert.equal(mounts, 2);
  controller.update(new URL('https://example.myschoolapp.com/app#two'), { ...DEFAULT_SETTINGS, enabled: false });
  assert.equal(signals[1].aborted, true);
  assert.equal(removals, 2);
  controller.dispose();
  assert.equal(removals, 2);
});

test('a failing feature cannot stop unrelated features from working', () => {
  let errorCount = 0;
  let mounted = false;
  let failedSignal: AbortSignal | undefined;
  const controller = new FeatureController([
    { id: 'broken', enabled: () => true, matches: () => true, mount: ({ signal }) => { failedSignal = signal; throw new Error('fixture failure'); } },
    { id: 'working', enabled: () => true, matches: () => true, mount: () => { mounted = true; } },
  ], () => { errorCount++; });
  controller.update(new URL('https://example.myschoolapp.com/app'), DEFAULT_SETTINGS);
  assert.equal(errorCount, 1);
  assert.equal(failedSignal?.aborted, true);
  assert.equal(mounted, true);
  controller.dispose();
});
