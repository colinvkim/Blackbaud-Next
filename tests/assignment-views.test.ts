import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { assignmentViewsFeature } from '../src/features/assignment-views.ts';
import { DEFAULT_SETTINGS } from '../src/shared/settings.ts';
import type { ExtensionApi } from '../src/shared/extension.ts';

function fixture(sendMessage?: ExtensionApi['runtime']['sendMessage']) {
  const dom = new JSDOM(`<app-student-assignment-center><sky-toolbar><sky-radio-group name="viewMode"><fieldset role="radiogroup"><div class="sky-switch-icon-group">
    <input type="radio" name="viewMode" value="1"><input type="radio" name="viewMode" value="0" checked>
  </div></fieldset></sky-radio-group></sky-toolbar><main>Native assignments</main></app-student-assignment-center>`, { url:'https://example.myschoolapp.com/lms-assignment/assignment-center/student' });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window:dom.window, document:dom.window.document, HTMLElement:dom.window.HTMLElement, MutationObserver:dom.window.MutationObserver, ...(sendMessage ? { chrome:{ storage:{}, runtime:{ sendMessage } } } : {}) })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable:true, value });
  }
  const controller = new AbortController();
  assignmentViewsFeature.mount({ url:new URL(dom.window.location.href), signal:controller.signal, settings:DEFAULT_SETTINGS });
  const cleanup = () => {
    controller.abort();
    dom.window.close();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  };
  return { dom, controller, cleanup };
}

test('a stalled classic load offers the full native page and abort clears the pending view', t => {
  t.mock.timers.enable({ apis:['setTimeout'] });
  const { controller, cleanup } = fixture();
  try {
    document.querySelector<HTMLInputElement>('.bn-classic-view-input')!.click();
    t.mock.timers.tick(19_999);
    assert.ok(document.querySelector('.bn-classic-loading'));
    t.mock.timers.tick(1);
    assert.equal(document.querySelector<HTMLAnchorElement>('.bn-classic-error a')!.href, 'https://example.myschoolapp.com/app/student?svcid=edu#studentmyday/assignment-center');
    assert.equal(document.querySelector('iframe'), null);
    controller.abort();
    assert.equal(document.querySelector('.bn-classic-panel, .bn-classic-view-label, [data-bn-classic-hidden]'), null);
    assert.equal(document.querySelector<HTMLInputElement>('input[value="0"]')!.checked, true);
  } finally { cleanup(); }
});

test('a native frame reload gets a new loading deadline after its first successful load', t => {
  t.mock.timers.enable({ apis:['setTimeout'] });
  const { dom, cleanup } = fixture();
  try {
    document.querySelector<HTMLInputElement>('.bn-classic-view-input')!.click();
    const frame = document.querySelector<HTMLIFrameElement>('iframe')!;
    const load = (html: string) => {
      const page = frame.contentDocument!;
      page.open();
      page.write(html);
      page.close();
      frame.dispatchEvent(new dom.window.Event('load'));
    };
    load('<html><head></head><body><main id="site-main"><div id="assignment-center"><div id="assignment-center-header-view"><div class="assignment-calendar-header"></div></div><div id="assignment-center-content-view"></div></div></main></body></html>');
    assert.equal(frame.hidden, false);
    t.mock.timers.tick(20_000);
    assert.equal(document.querySelector('.bn-classic-error'), null);
    load('<html><head></head><body>Native loading shell</body></html>');
    t.mock.timers.tick(20_000);
    assert.ok(document.querySelector('.bn-classic-error a'));
  } finally { cleanup(); }
});

for (const reason of ['selection', 'abort', 'navigation']) {
  test(`a late saved view cannot override ${reason}`, async () => {
    let resolveRead: (value: unknown) => void = () => {};
    const read = new Promise<unknown>(resolve => { resolveRead = resolve; });
    const { dom, controller, cleanup } = fixture(async raw => {
      const request = (raw as { request: { action:string } }).request;
      return request.action === 'get' ? read : { ok:true };
    });
    try {
      if (reason === 'selection') document.querySelector<HTMLInputElement>('input[value="1"]')!.click();
      if (reason === 'abort') controller.abort();
      if (reason === 'navigation') dom.reconfigure({ url:'https://example.myschoolapp.com/sis-scheduling/user-calendar' });
      resolveRead({ ok:true, value:'classic' });
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(document.querySelector('.bn-classic-frame'), null);
      if (reason === 'selection') assert.equal(document.querySelector<HTMLInputElement>('input[value="1"]')!.checked, true);
      if (reason === 'abort') assert.equal(document.querySelector('.bn-classic-view-label'), null);
    } finally { cleanup(); }
  });
}
