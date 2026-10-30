import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { addStyle, markOwned, observeDom, observeElementContext, watchAddedElements } from '../src/shared/dom.ts';
import { createAttributeOwnership } from '../src/shared/attribute-ownership.ts';
import { createScope } from '../src/shared/scope.ts';

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
let close: (() => void) | undefined;
afterEach(() => { close?.(); close = undefined; });
function fixture(html = '<section><div id="row"><span>Native</span></div></section><aside></aside>') {
  const dom = new JSDOM(html);
  const previous = { document: globalThis.document, MutationObserver: globalThis.MutationObserver };
  Object.assign(globalThis, { document: dom.window.document, MutationObserver: dom.window.MutationObserver });
  close = () => { Object.assign(globalThis, previous); dom.window.close(); };
  return dom.window;
}

test('owned content stays quiet while native removals can trigger UI repair', async () => {
  fixture();
  const abort = new AbortController();
  const row = document.querySelector<HTMLElement>('#row')!;
  const ui = markOwned(document.createElement('div'));
  let updates = 0;
  const mounts: Element[] = [];
  const removals: Element[] = [];
  const stop = observeElementContext(row, () => { updates++; }, { subtree: true });
  let refreshes = 0;
  observeDom(() => { refreshes++; }, abort.signal);
  watchAddedElements('.candidate', (element) => {
    mounts.push(element);
    return () => { removals.push(element); };
  }, abort.signal);
  row.append(ui);
  ui.innerHTML = '<span class="candidate">Injected</span>';
  await flush();
  ui.querySelector('span')!.firstChild!.textContent = 'Changed';
  ui.hidden = true;
  await flush();
  assert.equal(updates, 0);
  assert.equal(refreshes, 1);
  assert.deepEqual(mounts, []);
  row.insertAdjacentHTML('beforeend', '<b class="candidate">Native</b>');
  ui.hidden = false;
  await flush();
  assert.equal(updates, 1);
  assert.equal(refreshes, 2);
  assert.equal(mounts.length, 1);
  ui.remove();
  await flush();
  assert.equal(refreshes, 3);
  assert.equal(updates, 2);
  abort.abort();
  stop();
  assert.deepEqual(removals, mounts);
});

test('initial and incremental discovery skip matching descendants of owned roots', async () => {
  fixture('<div data-bn-owned><b class="target"></b></div><section></section>');
  const abort = new AbortController();
  let mounts = 0;
  watchAddedElements('.target', () => { mounts++; }, abort.signal);
  document.querySelector('section')!.innerHTML = '<div data-bn-owned><i class="target"></i></div><i class="target"></i>';
  await flush();
  assert.equal(mounts, 1);
  abort.abort();
});

test('context routing batches shared ancestry and follows rows through a fresh wrapper', async () => {
  fixture();
  const row = document.querySelector<HTMLElement>('#row')!;
  const section = document.querySelector('section')!;
  const aside = document.querySelector('aside')!;
  const changes: Array<{ moved: boolean; ancestors: boolean; contents: boolean }> = [];
  let second = 0;
  const stop = observeElementContext(row, (change) => changes.push(change), { subtree: true });
  const stopSecond = observeElementContext(row, () => { second++; });
  aside.className = 'unrelated';
  await flush();
  assert.deepEqual(changes, []);
  section.hidden = true;
  section.className = 'collapsed';
  await flush();
  assert.deepEqual(changes, [{ moved: false, ancestors: true, contents: false }]);
  assert.equal(second, 1);
  const wrapper = document.createElement('div');
  wrapper.append(row);
  aside.append(wrapper);
  await flush();
  assert.deepEqual(changes.at(-1), { moved: true, ancestors: false, contents: false });
  section.hidden = false;
  await flush();
  assert.equal(changes.length, 2);
  wrapper.hidden = true;
  row.querySelector('span')!.firstChild!.textContent = 'Updated native text';
  await flush();
  assert.deepEqual(changes.at(-1), { moved: false, ancestors: true, contents: true });
  assert.equal(second, 3);
  stop();
  stopSecond();
  wrapper.hidden = false;
  await flush();
  assert.equal(changes.length, 3);
});

test('a removed context subscription stays inactive later in the same delivery', async () => {
  fixture();
  const row = document.querySelector<HTMLElement>('#row')!;
  let second = 0;
  let stopSecond = () => {};
  const stop = observeElementContext(row, () => stopSecond());
  stopSecond = observeElementContext(row, () => { second++; });
  row.hidden = true;
  await flush();
  assert.equal(second, 0);
  stop();
});

test('ownership restores individual properties and priorities while preserving native replacements', () => {
  fixture();
  const row = document.querySelector<HTMLElement>('#row')!;
  row.setAttribute('data-marker', 'native');
  row.style.setProperty('--column', '140px', 'important');
  row.style.color = 'red';
  const owned = createAttributeOwnership();
  owned.mark(row, 'data-marker', 'ours');
  owned.mark(row, 'data-marker', 'next');
  owned.style(row, '--column', '200px');
  owned.style(row, '--temporary', '10px');
  owned.clear();
  assert.equal(row.getAttribute('data-marker'), 'native');
  assert.equal(row.style.getPropertyValue('--column'), '140px');
  assert.equal(row.style.getPropertyPriority('--column'), 'important');
  assert.equal(row.style.getPropertyValue('--temporary'), '');
  assert.equal(row.style.color, 'red');
  owned.mark(row, 'data-marker', 'ours');
  owned.style(row, '--column', '200px');
  row.setAttribute('data-marker', 'new-native');
  row.style.setProperty('--column', '300px', 'important');
  owned.clear();
  assert.equal(row.getAttribute('data-marker'), 'new-native');
  assert.equal(row.style.getPropertyValue('--column'), '300px');
  assert.equal(row.style.getPropertyPriority('--column'), 'important');
});

test('inline ownership restores CSSOM-normalized values and does not repeat unchanged writes', async () => {
  fixture();
  const row = document.querySelector<HTMLElement>('#row')!;
  row.style.color = 'red';
  row.style.marginLeft = '2px';
  const owned = createAttributeOwnership();
  owned.style(row, 'color', '#fff');
  owned.style(row, 'margin-left', '0');
  assert.equal(row.style.color, 'rgb(255, 255, 255)');
  assert.equal(row.style.marginLeft, '0px');
  let changes = 0;
  const observer = new MutationObserver((records) => { changes += records.length; });
  observer.observe(row, { attributes: true });
  owned.style(row, 'color', '#fff');
  owned.style(row, 'margin-left', '0');
  await flush();
  assert.equal(changes, 0);
  observer.disconnect();
  owned.clear();
  assert.equal(row.style.color, 'red');
  assert.equal(row.style.marginLeft, '2px');
});

test('style leases deduplicate and release independently with idempotent cleanup', () => {
  fixture();
  const first = addStyle('lease', '#row { color: red; }');
  const second = addStyle('lease', '#row { color: red; }');
  assert.equal(document.querySelectorAll('#blackbaud-next-lease').length, 1);
  assert.throws(() => addStyle('lease', '#row { color: blue; }'), /Conflicting/);
  first();
  first();
  assert.equal(document.querySelectorAll('#blackbaud-next-lease').length, 1);
  second();
  assert.equal(document.querySelectorAll('#blackbaud-next-lease').length, 0);
});

test('scopes stop listeners and drain cleanup after an error or repeated disposal', () => {
  const win = fixture();
  const parent = new AbortController();
  const scope = createScope(parent.signal);
  const row = document.querySelector<HTMLElement>('#row')!;
  let clicks = 0;
  const restored: number[] = [];
  scope.listen(row, 'click', () => { clicks++; });
  scope.add(() => { restored.push(1); });
  scope.add(() => { throw new Error('Cleanup failed'); });
  scope.add(() => { restored.push(2); });
  scope.style('scope', '#row { color: red; }');
  row.click();
  assert.equal(clicks, 1);
  const warn = console.warn;
  console.warn = () => {};
  try { parent.abort(); } finally { console.warn = warn; }
  row.dispatchEvent(new win.MouseEvent('click'));
  scope.dispose();
  scope.add(() => { restored.push(3); });
  assert.equal(clicks, 1);
  assert.deepEqual(restored, [2, 1, 3]);
  assert.equal(document.querySelector('#blackbaud-next-scope'), null);
  assert.equal(scope.signal.aborted, true);
});
