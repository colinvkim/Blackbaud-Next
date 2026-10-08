import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { observeDom, watchAddedElements, watchElements, waitForElement } from '../src/shared/dom.ts';

test('rerenders mount controls once and remove disconnected controls and observers', async () => {
  const dom = new JSDOM('<div id="host"><span class="target"></span></div>');
  const previous = { document: globalThis.document, MutationObserver: globalThis.MutationObserver };
  Object.assign(globalThis, { document: dom.window.document, MutationObserver: dom.window.MutationObserver });
  const controller = new AbortController();
  let mounts = 0;
  let removals = 0;
  try {
    const cleanup = watchElements('.target', () => { mounts++; return () => { removals++; }; }, controller.signal);
    document.querySelector('#host')!.append(document.createElement('b'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(mounts, 1);
    document.querySelector('#host')!.innerHTML = '<span class="target"></span>';
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(mounts, 2);
    assert.equal(removals, 1);
    controller.abort();
    cleanup();
    assert.equal(removals, 2);
    document.querySelector('#host')!.append(document.createElement('b'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(mounts, 2);
  } finally { controller.abort(); Object.assign(globalThis, previous); dom.window.close(); }
});

test('class, ID, and hidden changes activate reused native elements and clean them up', async () => {
  const dom = new JSDOM('<div id="mask"></div><div data-anchor="id"></div><div class="target" hidden></div>');
  const previous = { document: globalThis.document, MutationObserver: globalThis.MutationObserver };
  Object.assign(globalThis, { document: dom.window.document, MutationObserver: dom.window.MutationObserver });
  const controller = new AbortController();
  let mounts = 0;
  let removals = 0;
  try {
    watchElements('.sky-wait-mask-loading-blocking, #late-anchor, .target:not([hidden])', () => {
      mounts++;
      return () => { removals++; };
    }, controller.signal);
    document.getElementById('mask')!.className = 'sky-wait-mask sky-wait-mask-loading-blocking';
    document.querySelector('[data-anchor="id"]')!.id = 'late-anchor';
    document.querySelector('.target')!.removeAttribute('hidden');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(mounts, 3);
    document.getElementById('mask')!.className = 'sky-wait-mask';
    document.getElementById('late-anchor')!.removeAttribute('id');
    document.querySelector('.target')!.setAttribute('hidden', '');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(removals, 3);
    controller.abort();
    assert.equal(removals, 3);
  } finally { controller.abort(); Object.assign(globalThis, previous); dom.window.close(); }
});

test('a batch of native attribute changes produces one observer update', async () => {
  const dom = new JSDOM('<div id="host"></div>');
  const previous = { document: globalThis.document, MutationObserver: globalThis.MutationObserver };
  Object.assign(globalThis, { document: dom.window.document, MutationObserver: dom.window.MutationObserver });
  const controller = new AbortController();
  let updates = 0;
  try {
    observeDom(() => { updates++; }, controller.signal);
    const host = document.getElementById('host')!;
    host.className = 'loading';
    host.id = 'loaded-host';
    host.setAttribute('hidden', '');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(updates, 2);
  } finally { controller.abort(); Object.assign(globalThis, previous); dom.window.close(); }
});

test('waiting for a missing anchor settles on cancellation and finds late anchors', async () => {
  const dom = new JSDOM('<div></div>');
  const previous = { document: globalThis.document, MutationObserver: globalThis.MutationObserver };
  Object.assign(globalThis, { document: dom.window.document, MutationObserver: dom.window.MutationObserver });
  try {
    const canceled = new AbortController();
    const absent = waitForElement('.missing', canceled.signal, 1000);
    canceled.abort();
    assert.equal(await absent, null);
    const controller = new AbortController();
    const found = waitForElement('.late', controller.signal, 1000);
    const element = document.createElement('div');
    element.className = 'late';
    document.body.append(element);
    assert.equal(await found, element);
    controller.abort();
  } finally { Object.assign(globalThis, previous); dom.window.close(); }
});

test('incremental discovery follows moved, reused, and replaced elements only within its root', async () => {
  const dom = new JSDOM('<div id="host"><span class="target"></span><i></i></div><aside><span class="target"></span></aside>');
  const previous = { document: globalThis.document, MutationObserver: globalThis.MutationObserver };
  Object.assign(globalThis, { document: dom.window.document, MutationObserver: dom.window.MutationObserver });
  const controller = new AbortController();
  const mounted = new Set<Element>();
  const removed: Element[] = [];
  try {
    const host = document.querySelector('#host')!;
    const cleanup = watchAddedElements('.target', (element) => {
      mounted.add(element);
      return () => { mounted.delete(element); removed.push(element); };
    }, controller.signal, host, ['class']);
    assert.equal(mounted.size, 1);
    const reused = host.querySelector('i')!;
    reused.className = 'target';
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(mounted.size, 2);
    reused.className = '';
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(removed, [reused]);
    const original = host.querySelector('.target')!;
    document.querySelector('aside')!.append(original);
    host.insertAdjacentHTML('beforeend', '<section><b class="target"></b></section>');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(mounted.size, 1);
    assert.equal(mounted.has(original), false);
    controller.abort();
    cleanup();
    assert.equal(mounted.size, 0);
    assert.equal(removed.length, 3);
  } finally { controller.abort(); Object.assign(globalThis, previous); dom.window.close(); }
});

test('incremental discovery cleans a mount canceled before it returns', () => {
  const dom = new JSDOM('<span class="target"></span><span class="target"></span>');
  const previous = { document: globalThis.document, MutationObserver: globalThis.MutationObserver };
  Object.assign(globalThis, { document: dom.window.document, MutationObserver: dom.window.MutationObserver });
  const controller = new AbortController();
  let mounts = 0;
  let removals = 0;
  try {
    const cleanup = watchAddedElements('.target', () => {
      mounts += 1;
      controller.abort();
      return () => { removals += 1; };
    }, controller.signal);
    cleanup();
    assert.equal(mounts, 1);
    assert.equal(removals, 1);
  } finally { controller.abort(); Object.assign(globalThis, previous); dom.window.close(); }
});
