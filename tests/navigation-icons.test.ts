import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { createNavigationIcons } from '../src/features/navigation-icons.ts';
import { nativeNavigationIconTargets } from '../src/blackbaud/appearance-icons.ts';
import type { NativeNavigationIconTarget } from '../src/blackbaud/appearance-icons.ts';

function fixture(previous?: string) {
  const view = new JSDOM('<a id="classes" href="#"><img src="classes.png"><span>Classes</span><span class="caret"></span></a>', { url: 'https://school.myschoolapp.com/app/student' });
  const control = view.window.document.querySelector<HTMLAnchorElement>('a')!;
  const original = control.querySelector('img')!;
  if (previous !== undefined) original.setAttribute('data-bn-native-icon', previous);
  const target: NativeNavigationIconTarget = { control, original, kind: 'book-open' };
  return { view, control, original, target };
}

test('navigation decoration preserves the native anchor, accessible text, destination, caret, and actions', () => {
  const { view, control, original, target } = fixture();
  const icons = createNavigationIcons();
  try {
    const text = control.textContent;
    const caret = control.querySelector('.caret');
    let clicks = 0;
    control.addEventListener('click', (event) => { event.preventDefault(); clicks++; });
    icons.update([target]);
    const icon = control.querySelector('svg')!;
    assert.equal(icon.ownerDocument, view.window.document);
    assert.equal(icon.getAttribute('aria-hidden'), 'true');
    assert.equal(icon.getAttribute('focusable'), 'false');
    assert.equal(control.textContent, text);
    assert.equal(control.getAttribute('href'), '#');
    assert.equal(control.querySelector('.caret'), caret);
    assert.equal(control.querySelector('img'), original);
    icon.dispatchEvent(new view.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    assert.equal(clicks, 1);
    icons.clear();
    assert.equal(control.querySelector('svg'), null);
    assert.equal(original.hasAttribute('data-bn-native-icon'), false);
    control.click();
    assert.equal(clicks, 2);
  } finally { icons.clear(); view.window.close(); }
});

test('unchanged navigation keeps its SVG mounted and repairs native child rerenders without duplication', () => {
  const { view, control, target } = fixture();
  const icons = createNavigationIcons();
  try {
    icons.update([target]);
    const first = control.querySelector('svg')!;
    icons.update([target]);
    assert.equal(control.querySelector('svg'), first);
    first.remove();
    icons.update([target]);
    assert.equal(control.querySelector('svg'), first);
    assert.equal(control.querySelectorAll('svg').length, 1);
  } finally { icons.clear(); view.window.close(); }
});

test('replacement originals and departed controls restore previous native attributes, including disconnected nodes', () => {
  const { view, control, original, target } = fixture('native');
  const icons = createNavigationIcons();
  try {
    icons.update([target]);
    const old = control.querySelector('svg')!;
    const replacement = original.cloneNode() as HTMLImageElement;
    replacement.removeAttribute('data-bn-native-icon');
    original.replaceWith(replacement);
    icons.update([{ ...target, original: replacement }]);
    assert.equal(original.getAttribute('data-bn-native-icon'), 'native');
    assert.equal(old.isConnected, false);
    assert.equal(replacement.getAttribute('data-bn-native-icon'), 'replaced');
    control.remove();
    icons.update([]);
    assert.equal(replacement.hasAttribute('data-bn-native-icon'), false);
    assert.equal(control.querySelector('svg'), null);
    icons.clear();
  } finally { icons.clear(); view.window.close(); }
});

test('a modern item without an original image can be decorated and cleanly released', () => {
  const { view, control, original, target } = fixture();
  const icons = createNavigationIcons();
  try {
    original.remove();
    icons.update([{ ...target, original: null }]);
    assert.equal(control.querySelectorAll('svg').length, 1);
    icons.clear();
    icons.clear();
    assert.equal(control.querySelector('svg'), null);
    assert.equal(control.textContent, 'Classes');
    assert.ok(control.querySelector('.caret'));
  } finally { icons.clear(); view.window.close(); }
});

test('My Day replacement keeps live native dates and anchor actions through badge and shell rerenders and cleanup', () => {
  const url = new URL('https://school.myschoolapp.com/app/student#studentmyday/progress');
  const view = new JSDOM(`<header id="site-header"></header><nav id="site-nav-container"><ul class="topnav"><li><a href="?svcid=edu#studentmyday/progress" aria-label="My Day"><div class="dayicon pri-50-bgc" data-bn-native-icon="native"><span class="month white-fgc">OCT</span><span class="day white-bgc">9</span></div><span class="desc"><span class="title">My Day</span></span></a></li></ul></nav><main id="site-main"></main>`, { url: url.href });
  const page = view.window.document;
  const control = page.querySelector<HTMLAnchorElement>('a')!;
  const badge = control.querySelector('.dayicon')!;
  const icons = createNavigationIcons();
  let clicks = 0;
  control.addEventListener('click', (event) => { event.preventDefault(); clicks++; });
  try {
    icons.update(nativeNavigationIconTargets(page, url));
    const first = control.querySelector('svg')!;
    assert.equal(first.getAttribute('data-bn-navigation-icon'), 'house');
    assert.equal(badge.getAttribute('data-bn-native-icon'), 'replaced');
    badge.querySelector('.day')!.textContent = '10';
    icons.update(nativeNavigationIconTargets(page, url));
    assert.equal(control.querySelector('svg'), first, 'A native date update keeps the unchanged enhancement mounted');
    assert.equal(badge.querySelector('.day')!.textContent, '10');
    assert.equal(badge.querySelector('.month')!.textContent, 'OCT');
    first.dispatchEvent(new view.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    assert.equal(clicks, 1);
    assert.equal(control.getAttribute('href'), '?svcid=edu#studentmyday/progress');
    assert.equal(control.getAttribute('aria-label'), 'My Day');
    icons.clear();
    assert.equal(badge.getAttribute('data-bn-native-icon'), 'native');
    assert.equal(badge.querySelector('.day')!.textContent, '10', 'Cleanup restores the current native date, not an old snapshot');
    icons.update(nativeNavigationIconTargets(page, url));
    const replacement = page.createElement('div');
    replacement.className = 'dayicon';
    replacement.innerHTML = '<span class="month">OCT</span><span class="day">11</span>';
    badge.replaceWith(replacement);
    icons.update(nativeNavigationIconTargets(page, url));
    assert.equal(badge.getAttribute('data-bn-native-icon'), 'native');
    assert.equal(control.querySelectorAll('svg').length, 1);
    assert.equal(replacement.getAttribute('data-bn-native-icon'), 'replaced');
    replacement.setAttribute('aria-controls', 'native-calendar');
    icons.update(nativeNavigationIconTargets(page, url));
    assert.equal(control.querySelector('svg'), null, 'A badge that becomes interactive falls back to native');
    assert.equal(replacement.hasAttribute('data-bn-native-icon'), false);
    replacement.removeAttribute('aria-controls');
    icons.update(nativeNavigationIconTargets(page, url));
    const newControl = control.cloneNode(true) as HTMLAnchorElement;
    newControl.querySelector('svg')!.remove();
    newControl.querySelector('.dayicon')!.removeAttribute('data-bn-native-icon');
    control.replaceWith(newControl);
    icons.update(nativeNavigationIconTargets(page, url));
    assert.equal(control.querySelector('svg'), null);
    assert.equal(replacement.hasAttribute('data-bn-native-icon'), false);
    assert.equal(newControl.querySelectorAll('svg').length, 1);
    icons.clear();
    assert.equal(newControl.querySelector('svg'), null);
    assert.equal(newControl.querySelector('.dayicon .day')!.textContent, '11');
    assert.equal(newControl.querySelector('.dayicon .month')!.textContent, 'OCT');
    assert.equal(newControl.querySelector('.dayicon')!.hasAttribute('data-bn-native-icon'), false);
  } finally { icons.clear(); view.window.close(); }
});
