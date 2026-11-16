import { expect, test } from '@playwright/test';
import { andysuAvailable, applyAction, canCheck, statusText } from './andysu';

test('AndySU is unavailable without the bridge', () => {
  expect(andysuAvailable()).toBe(false);
});

test('an unchecked state is never called up to date', () => {
  for (const state of ['idle', 'error', 'unknown', 'deferred', undefined]) {
    expect(statusText({ state, runningVersion: '1' })).not.toContain('Up to date');
  }
});

test('every state has one plain line', () => {
  expect(statusText({ state: 'up_to_date' })).toBe('Up to date');
  expect(statusText({ state: 'staged', release: '1', runningVersion: '1' })).toBe('Up to date');
  expect(statusText({ state: 'staged', release: '2', runningVersion: '1' })).toContain('Update ready');
  expect(statusText({ state: 'checking' })).toContain('Checking');
  expect(statusText({ state: 'downloading', percent: 40.4 })).toBe('Downloading update · 40%');
  expect(statusText({ state: 'downloading' })).toBe('Downloading update…');
  expect(statusText({ state: 'applying' })).toContain('Applying');
  expect(statusText({ state: 'shell_update' })).toContain('new app install');
  expect(statusText({ state: 'available' })).toContain('available');
  expect(statusText({ state: 'error' })).toContain('Couldn’t');
  expect(statusText({ state: 'deferred' })).toContain('postponed');
  expect(statusText({ state: 'idle' })).toContain('haven’t been checked');
});

test('an action is offered only when there is something to apply', () => {
  expect(applyAction({ state: 'shell_update' })).toBe('Install');
  expect(applyAction({ state: 'staged', release: '2', runningVersion: '1' })).toBe('Apply now');
  for (const s of [{ state: 'staged', release: '1', runningVersion: '1' }, { state: 'idle' }, { state: 'downloading' }, { state: 'error' }, { state: 'up_to_date' }, {}]) {
    expect(applyAction(s)).toBeNull();
  }
});

test('checking is not offered while one is running', () => {
  expect(canCheck({ state: 'checking' })).toBe(false);
  expect(canCheck({ state: 'downloading' })).toBe(false);
  expect(canCheck({ state: 'idle' })).toBe(true);
  expect(canCheck({})).toBe(true);
});

test('live wording requires a matching running payload, and staged never promises manual reopen', () => {
  expect(statusText({ state: 'up_to_date', runningVersion: '1.2.3', liveAppliedVersion: '1.2.3' })).toBe('Update applied live');
  expect(statusText({ state: 'up_to_date', runningVersion: '1.2.4', liveAppliedVersion: '1.2.3' })).toBe('Up to date');
  expect(statusText({ state: 'staged', release: '1.2.4', runningVersion: '1.2.3' })).toContain('applying automatically');
});
