import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { ASSIGNMENT_PREVIEW_IDENTITY_LIFETIME, assignmentInstructions, assignmentPreviewTarget, createAssignmentPreviewReader, currentStudentUserId, fetchAssignmentPreview, normalizeAssignmentPreview, safeAssignmentUrl } from '../src/blackbaud/assignment-preview.ts';
import type { AssignmentPreviewTarget } from '../src/blackbaud/assignment-preview.ts';
import { assignmentPreviewFeature } from '../src/features/assignment-preview.ts';
import { assignmentShortcutsFeature } from '../src/features/assignment-shortcuts.ts';
import { DEFAULT_SETTINGS } from '../src/shared/settings.ts';
import type { Cleanup } from '../src/shared/types.ts';

let dom: JSDOM | undefined;
let restore: Cleanup = () => {};
const cleanups: Cleanup[] = [];

function fixture(html: string) {
  dom = new JSDOM(html, { url: 'https://example.myschoolapp.com/lms-assignment/assignment-center/student' });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  const globals = {
    window: dom.window,
    document: dom.window.document,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    HTMLAnchorElement: dom.window.HTMLAnchorElement,
    MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  };
  for (const [key, value] of Object.entries(globals)) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  restore = () => {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  };
  return dom.window;
}

async function flush() {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

function target(id = '123'): AssignmentPreviewTarget {
  return { assignmentIndexId: id, detailsUrl: `https://example.myschoolapp.com/lms-assignment/assignment/assignment-student-view/${id}`, title: `Assignment ${id}` };
}

function assignment(id = 123, title = `Assignment ${id}`) {
  return {
    AssignmentIndexId: id, ShortDescription: title, LongDescription: '<p>Read the <strong>instructions</strong>.</p>',
    DueDate: '10/8/2026 11:59 PM', GroupName: 'Example class', LinkItems: [], DownloadItems: [],
  };
}

function mount() {
  const controller = new AbortController();
  cleanups.push(() => controller.abort());
  const cleanup = assignmentPreviewFeature.mount({ url: new URL(window.location.href), signal: controller.signal, settings: DEFAULT_SETTINGS });
  if (cleanup) cleanups.push(cleanup);
  return controller;
}

function nativeLink(id: number, title = `Assignment ${id}`): string {
  return `<app-assignment-title-link><a href="/lms-assignment/assignment/assignment-student-view/${id}">${title}</a></app-assignment-title-link>`;
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  dom?.window.close();
  dom = undefined;
  restore();
  restore = () => {};
});

test('preview rich text preserves instructions while discarding active content and unsafe attributes', () => {
  const win = fixture('');
  const content = assignmentInstructions('<p id="native" onclick="bad()" style="display:none">Read <strong>chapter one</strong>.</p><script>bad()</script><svg><a href="javascript:bad()">hidden</a></svg><iframe src="https://foreign.example/"></iframe><img src="https://foreign.example/track"><a href="javascript:bad()" onmouseover="bad()">Unsafe</a><a href="/downloads/example.pdf" target="_self">Worksheet</a>', win.location.href);
  win.document.body.append(content);
  assert.match(win.document.body.textContent ?? '', /Read chapter one/);
  assert.equal(win.document.querySelector('script, svg, iframe, img, [onclick], [style], [id], [onmouseover]'), null);
  const links = win.document.querySelectorAll('a');
  assert.equal(links[0]!.hasAttribute('href'), false);
  assert.equal(links[1]!.href, 'https://example.myschoolapp.com/downloads/example.pdf');
  assert.equal(links[1]!.target, '_blank');
  assert.equal(links[1]!.rel, 'noopener noreferrer');
});

test('an already-aborted preview mount creates no UI, style, observer work, or requests', async (t) => {
  const win = fixture(nativeLink(123));
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests += 1; return new Response('{}'); });
  const controller = new AbortController();
  controller.abort();
  const cleanup = assignmentPreviewFeature.mount({ url: new URL(win.location.href), signal: controller.signal, settings: DEFAULT_SETTINGS });
  assert.equal(cleanup, undefined);
  win.document.body.insertAdjacentHTML('beforeend', nativeLink(456));
  await flush();
  assert.equal(win.document.querySelector('[data-blackbaud-next-preview], .bn-preview-panel, #blackbaud-next-assignment-previews'), null);
  assert.equal(requests, 0);
});

test('preview links reject unsafe schemes, embedded credentials, and insecure external downloads', () => {
  const base = 'https://example.myschoolapp.com/app/student';
  assert.equal(safeAssignmentUrl('/download/example.pdf', base), 'https://example.myschoolapp.com/download/example.pdf');
  assert.equal(safeAssignmentUrl('https://files.example.org/worksheet.pdf', base), 'https://files.example.org/worksheet.pdf');
  for (const value of ['javascript:alert(1)', 'data:text/html,bad', 'http://files.example.org/file', 'https://user:secret@files.example.org/file']) {
    assert.equal(safeAssignmentUrl(value, base), null);
  }
});

test('preview identifiers come only from same-origin native assignment detail links', () => {
  const win = fixture('<app-assignment-title-link><a href="/lms-assignment/assignment/assignment-student-view/123">Example assignment</a></app-assignment-title-link>');
  const link = win.document.querySelector('a')!;
  assert.deepEqual(assignmentPreviewTarget(link, win.location.href), {
    assignmentIndexId: '123', title: 'Example assignment', detailsUrl: 'https://example.myschoolapp.com/lms-assignment/assignment/assignment-student-view/123',
  });
  for (const href of ['https://foreign.example/lms-assignment/assignment/assignment-student-view/123', '/lms-assignment/assignment/assignment-student-view/123other', '/lms-assignment/assignment/assignment-student-view/0', '#123', '/app/student#assignment/123']) {
    link.setAttribute('href', href);
    assert.equal(assignmentPreviewTarget(link, win.location.href), null);
  }
});

test('preview target labels normalize literal rich title strings while preserving the native link', () => {
  const win = fixture(nativeLink(123));
  const link = win.document.querySelector('a')!;
  const richTitle = '<span style="font-weight:400;">Read Example&#8211;&#8220;The Distant Shore&#8221;</span>';
  link.textContent = richTitle;
  mount();
  assert.equal(assignmentPreviewTarget(link, win.location.href)?.title, 'Read Example–“The Distant Shore”');
  assert.equal(win.document.querySelector('[data-blackbaud-next-preview]')!.getAttribute('aria-label'), 'Preview Read Example–“The Distant Shore”');
  assert.equal(link.textContent, richTitle);
  assert.equal(link.getAttribute('href'), '/lms-assignment/assignment/assignment-student-view/123');
});

test('already-rendered native title formatting keeps its nodes while preview labels use their plain text', () => {
  const win = fixture(nativeLink(123, '<span style="font-weight:400;">Read A &amp; B</span>'));
  const link = win.document.querySelector('a')!;
  const span = link.querySelector('span')!;
  mount();
  assert.equal(assignmentPreviewTarget(link, win.location.href)?.title, 'Read A & B');
  assert.equal(win.document.querySelector('[data-blackbaud-next-preview]')!.getAttribute('aria-label'), 'Preview Read A & B');
  assert.equal(link.querySelector('span'), span);
  assert.equal(span.getAttribute('style'), 'font-weight:400;');
});

test('rendered native code titles keep literal tags and entity syntax without a second decoding pass', async () => {
  const win = fixture(nativeLink(123, '<span>&lt;span&gt;code&lt;/span&gt; &amp;lt;tag&amp;gt;</span>'));
  const link = win.document.querySelector('a')!;
  mount();
  assert.equal(assignmentPreviewTarget(link, win.location.href)?.title, '<span>code</span> &lt;tag&gt;');
  assert.equal(win.document.querySelector('[data-blackbaud-next-preview]')!.getAttribute('aria-label'), 'Preview <span>code</span> &lt;tag&gt;');
  link.textContent = '<span>Updated&#8211;title</span>';
  await flush();
  assert.equal(win.document.querySelector('[data-blackbaud-next-preview]')!.getAttribute('aria-label'), 'Preview Updated–title');
});

test('API preview titles decode formatted descriptions and use the native target when formatting is empty', () => {
  fixture('');
  const richTitle = `<span style="${'font-weight:400;'.repeat(30)}">Read Example&#8211;&#8220;The Distant Shore&#8221;</span>`;
  assert.equal(normalizeAssignmentPreview(assignment(123, richTitle), target()).title, 'Read Example–“The Distant Shore”');
  assert.equal(normalizeAssignmentPreview(assignment(123, '<span>&nbsp;</span>'), { ...target(), title: 'Native fallback title' }).title, 'Native fallback title');
  assert.equal(normalizeAssignmentPreview(assignment(123, 'Use Array<T> &amp; Map<K,V>'), target()).title, 'Use Array<T> & Map<K,V>');
});

test('preview panel replaces its normalized initial title with a normalized fresh API title', async (t) => {
  const win = fixture(nativeLink(123));
  const link = win.document.querySelector('a')!;
  const richTitle = '<span style="font-weight:400;">Initial&#8211;reading</span>';
  link.textContent = richTitle;
  t.mock.method(globalThis, 'fetch', async (path: RequestInfo | URL) => new Response(JSON.stringify(String(path) === '/api/webapp/context'
    ? { UserInfo: { UserId: 42, DefaultPersonaId: 2 } }
    : assignment(123, '<strong>Fresh &amp; updated reading</strong>'))));
  mount();
  win.document.querySelector<HTMLButtonElement>('[data-blackbaud-next-preview]')!.click();
  assert.equal(win.document.querySelector('[role="dialog"] h2')!.textContent, 'Initial–reading');
  await flush();
  assert.equal(win.document.querySelector('[role="dialog"] h2')!.textContent, 'Fresh & updated reading');
  assert.equal(link.textContent, richTitle);
  assert.equal(win.document.querySelector('[role="dialog"] h2 span, [role="dialog"] h2 strong'), null);
});

test('preview responses validate the requested assignment and retain only display fields', () => {
  const preview = normalizeAssignmentPreview({ ...assignment(), AssignmentGrade: 'Private score', StudentUserId: 888, SubmissionResults: ['Private submission'], LinkItems: [
    { ShortDescription: 'Worksheet', Url: 'https://files.example.org/worksheet.pdf', OtherField: 'unused' },
    { ShortDescription: 'Duplicate', Url: 'https://files.example.org/worksheet.pdf' },
    { ShortDescription: 'Unsafe', Url: 'javascript:bad()' }, null,
  ] }, target());
  assert.deepEqual(preview.attachments, [{ name: 'Worksheet', url: 'https://files.example.org/worksheet.pdf' }]);
  assert.deepEqual(Object.keys(preview).sort(), ['attachments', 'course', 'due', 'instructions', 'title']);
  assert.equal(preview.due, '10/8/2026 11:59 PM');
  assert.throws(() => normalizeAssignmentPreview(assignment(456), target()), /unsupported format/);
  assert.throws(() => normalizeAssignmentPreview({ ...assignment(), AssignmentIndexId: '123' }, target()), /unsupported format/);
});

test('preview student identity uses current UserInfo and refuses another persona or ambiguous identity', () => {
  assert.equal(currentStudentUserId({ UserInfo: { UserId: 42, DefaultPersonaId: 2 }, MasterUserInfo: { UserId: 99 } }), 42);
  for (const payload of [null, { MasterUserInfo: { UserId: 42, DefaultPersonaId: 2 } }, { UserInfo: { UserId: 42, DefaultPersonaId: 1 } }, { UserInfo: { UserId: '42', DefaultPersonaId: 2 } }, { UserInfo: { UserId: -1, DefaultPersonaId: 2 } }]) {
    assert.throws(() => currentStudentUserId(payload), /current student/);
  }
});

test('preview downloads use native DownloadUrl with safe names and do not guess missing file paths', () => {
  const preview = normalizeAssignmentPreview({ ...assignment(), DownloadItems: [
    { ShortDescription: 'Worksheet', FriendlyFileName: 'example.pdf', DownloadUrl: '/ftpimages/1/download/example.pdf' },
    { FriendlyFileName: 'Reading.pdf', DownloadUrl: 'https://files.example.org/reading.pdf' },
    { ShortDescription: 'Duplicate', DownloadUrl: '/ftpimages/1/download/example.pdf' },
    { ShortDescription: 'Unsafe', DownloadUrl: 'javascript:bad()' },
    { FileName: 'not-a-verified-path.pdf', FriendlyFileName: 'Missing download URL' },
    null,
  ] }, target());
  assert.deepEqual(preview.attachments, [
    { name: 'Worksheet', url: 'https://example.myschoolapp.com/ftpimages/1/download/example.pdf' },
    { name: 'Reading.pdf', url: 'https://files.example.org/reading.pdf' },
  ]);
});

test('preview fetch keeps requests same-origin, forwards cancellation, and refuses mismatched identity', async (t) => {
  fixture('');
  const controller = new AbortController();
  const calls: Array<{ path: string; options?: RequestInit }> = [];
  t.mock.method(globalThis, 'fetch', async (path: RequestInfo | URL, options?: RequestInit) => {
    calls.push({ path: String(path), options });
    return new Response(JSON.stringify(String(path) === '/api/webapp/context' ? { UserInfo: { UserId: 42, DefaultPersonaId: 2 } } : assignment()));
  });
  await fetchAssignmentPreview(target(), controller.signal);
  assert.deepEqual(calls.map((call) => call.path), ['/api/webapp/context', '/api/assignment2/UserAssignmentDetailsGetAllStudentData?assignmentIndexId=123&studentUserId=42&personaId=2']);
  for (const call of calls) {
    assert.equal(call.options?.signal, controller.signal);
    assert.equal(call.options?.credentials, 'same-origin');
    assert.equal(call.options?.redirect, 'error');
  }
  await assert.rejects(fetchAssignmentPreview({ ...target(), detailsUrl: 'https://foreign.example/lms-assignment/assignment/assignment-student-view/123' }, controller.signal), /invalid/);
  assert.equal(calls.length, 2);
});

test('canceling a pending context read cannot start a later assignment request', async (t) => {
  fixture('');
  const controller = new AbortController();
  let resolveContext: ((response: Response) => void) | undefined;
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    return new Promise<Response>((resolve) => { resolveContext = resolve; });
  });
  const loading = fetchAssignmentPreview(target(), controller.signal);
  controller.abort();
  resolveContext?.(new Response(JSON.stringify({ UserInfo: { UserId: 42, DefaultPersonaId: 2 } })));
  await assert.rejects(loading, { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('preview opens beside untouched native links and Escape returns focus', async (t) => {
  const win = fixture(nativeLink(123));
  t.mock.method(globalThis, 'fetch', async (path: RequestInfo | URL) => new Response(JSON.stringify(String(path) === '/api/webapp/context' ? { UserInfo: { UserId: 42, DefaultPersonaId: 2 } } : assignment())));
  mount();
  const native = win.document.querySelector('a')!;
  const button = win.document.querySelector<HTMLButtonElement>('[data-blackbaud-next-preview]')!;
  button.click();
  await flush();
  const panel = win.document.querySelector<HTMLElement>('[role="dialog"]')!;
  assert.equal(native.getAttribute('href'), '/lms-assignment/assignment/assignment-student-view/123');
  assert.equal(native.textContent, 'Assignment 123');
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  assert.equal(panel.querySelector('h2')?.textContent, 'Assignment 123');
  assert.match(panel.textContent ?? '', /Read the instructions/);
  assert.equal(panel.querySelector('a')?.href, native.href);
  assert.equal(win.document.activeElement?.textContent, 'Close preview');
  win.document.activeElement!.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(win.document.querySelector('[role="dialog"]'), null);
  assert.equal(win.document.activeElement, button);
  assert.equal(button.getAttribute('aria-expanded'), 'false');
});

test('switching assignments aborts the old preview and ignores a late old response', async (t) => {
  const win = fixture(nativeLink(123) + nativeLink(456));
  const details: Array<{ path: string; signal: AbortSignal | null | undefined; resolve: (response: Response) => void }> = [];
  t.mock.method(globalThis, 'fetch', async (path: RequestInfo | URL, options?: RequestInit) => {
    if (String(path) === '/api/webapp/context') return new Response(JSON.stringify({ UserInfo: { UserId: 42, DefaultPersonaId: 2 } }));
    return new Promise<Response>((resolve) => { details.push({ path: String(path), signal: options?.signal, resolve }); });
  });
  mount();
  const buttons = win.document.querySelectorAll<HTMLButtonElement>('[data-blackbaud-next-preview]');
  buttons[0]!.click();
  await flush();
  buttons[1]!.click();
  await flush();
  assert.equal(details.length, 2);
  assert.equal(details[0]!.signal?.aborted, true);
  details[1]!.resolve(new Response(JSON.stringify(assignment(456, 'Current assignment'))));
  await flush();
  details[0]!.resolve(new Response(JSON.stringify(assignment(123, 'Old assignment'))));
  await flush();
  assert.equal(win.document.querySelector('[role="dialog"] h2')?.textContent, 'Current assignment');
  assert.equal(buttons[0]!.getAttribute('aria-expanded'), 'false');
  assert.equal(buttons[1]!.getAttribute('aria-expanded'), 'true');
});

test('closing a preview returns focus to its replacement button after the native row rerenders', async (t) => {
  const win = fixture(nativeLink(123));
  t.mock.method(globalThis, 'fetch', async (path: RequestInfo | URL) => new Response(JSON.stringify(String(path) === '/api/webapp/context' ? { UserInfo: { UserId: 42, DefaultPersonaId: 2 } } : assignment())));
  mount();
  win.document.querySelector<HTMLButtonElement>('[data-blackbaud-next-preview]')!.click();
  await flush();
  win.document.querySelector('app-assignment-title-link')!.outerHTML = nativeLink(123);
  await flush();
  const replacement = win.document.querySelector<HTMLButtonElement>('[data-blackbaud-next-preview]')!;
  assert.equal(replacement.getAttribute('aria-expanded'), 'true');
  win.document.querySelector<HTMLButtonElement>('[role="dialog"] button')!.click();
  assert.equal(win.document.activeElement, replacement);
  assert.equal(replacement.getAttribute('aria-expanded'), 'false');
});

test('closing a completed preview after Unfinished hides its row focuses the selected shortcut', async (t) => {
  const row = (id: number, status: string) => `<sky-repeater-item class="assignment-repeater-item">${nativeLink(id)}<app-assignment-status-display><button>${status}</button></app-assignment-status-display></sky-repeater-item>`;
  const win = fixture(`<sky-toolbar><input aria-label="Search items"></sky-toolbar>${row(123, 'Completed')}${row(456, 'To do')}`);
  t.mock.method(globalThis, 'fetch', async (path: RequestInfo | URL) => new Response(JSON.stringify(String(path) === '/api/webapp/context' ? { UserInfo: { UserId: 42, DefaultPersonaId: 2 } } : assignment())));
  const shortcuts = new AbortController();
  const cleanup = assignmentShortcutsFeature.mount({ url: new URL(win.location.href), signal: shortcuts.signal, settings: DEFAULT_SETTINGS });
  cleanups.push(() => { shortcuts.abort(); cleanup?.(); });
  mount();
  const completedPreview = win.document.querySelector<HTMLButtonElement>('[data-blackbaud-next-preview]')!;
  completedPreview.click();
  await flush();
  const unfinished = [...win.document.querySelectorAll<HTMLButtonElement>('.bn-assignment-shortcuts button')].find((button) => button.textContent === 'Unfinished')!;
  unfinished.click();
  assert.equal(completedPreview.closest('sky-repeater-item')?.getAttribute('data-blackbaud-next-shortcut-hidden'), 'true');
  assert.equal(unfinished.getAttribute('aria-pressed'), 'true');
  win.document.querySelector<HTMLButtonElement>('[role="dialog"] button')!.click();
  assert.equal(win.document.activeElement, unfinished);
  assert.equal(win.document.querySelector('[role="dialog"]'), null);
});

test('closing a preview whose row became hidden falls back to native assignment search', async (t) => {
  const win = fixture(`<sky-toolbar><input aria-label="Search items"></sky-toolbar><section>${nativeLink(123)}</section>`);
  t.mock.method(globalThis, 'fetch', async (path: RequestInfo | URL) => new Response(JSON.stringify(String(path) === '/api/webapp/context' ? { UserInfo: { UserId: 42, DefaultPersonaId: 2 } } : assignment())));
  mount();
  win.document.querySelector<HTMLButtonElement>('[data-blackbaud-next-preview]')!.click();
  await flush();
  win.document.querySelector('section')!.hidden = true;
  win.document.querySelector<HTMLButtonElement>('[role="dialog"] button')!.click();
  assert.equal(win.document.activeElement, win.document.querySelector('input[aria-label="Search items"]'));
});

test('preview failure keeps full navigation usable and retry can recover', async (t) => {
  const win = fixture(nativeLink(123));
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (path: RequestInfo | URL) => {
    if (String(path) === '/api/webapp/context') return new Response(JSON.stringify({ UserInfo: { UserId: 42, DefaultPersonaId: 2 } }));
    requests += 1;
    return requests === 1 ? new Response('unavailable', { status: 503 }) : new Response(JSON.stringify(assignment()));
  });
  mount();
  win.document.querySelector<HTMLButtonElement>('[data-blackbaud-next-preview]')!.click();
  await flush();
  const panel = win.document.querySelector('[role="dialog"]')!;
  assert.match(panel.textContent ?? '', /could not be loaded/);
  assert.equal(panel.querySelector('a')?.href, target().detailsUrl);
  [...panel.querySelectorAll('button')].find((button) => button.textContent === 'Retry preview')!.click();
  await flush();
  assert.equal(requests, 2);
  assert.match(panel.textContent ?? '', /Read the instructions/);
  assert.equal([...panel.querySelectorAll('button')].some((button) => button.textContent === 'Retry preview'), false);
});

test('rerendered links get one current preview button and feature teardown aborts pending work', async (t) => {
  const win = fixture(nativeLink(123));
  let requestSignal: AbortSignal | null | undefined;
  let resolveRequest: ((response: Response) => void) | undefined;
  t.mock.method(globalThis, 'fetch', async (_path: RequestInfo | URL, options?: RequestInit) => {
    requestSignal = options?.signal;
    return new Promise<Response>((resolve) => { resolveRequest = resolve; });
  });
  const controller = mount();
  win.document.querySelector('app-assignment-title-link')!.outerHTML = nativeLink(456, 'New assignment');
  await flush();
  assert.equal(win.document.querySelectorAll('[data-blackbaud-next-preview]').length, 1);
  const button = win.document.querySelector<HTMLButtonElement>('[data-blackbaud-next-preview]')!;
  assert.equal(button.getAttribute('aria-label'), 'Preview New assignment');
  button.click();
  controller.abort();
  assert.equal(requestSignal?.aborted, true);
  assert.equal(win.document.querySelector('[role="dialog"]'), null);
  assert.equal(win.document.querySelector('[data-blackbaud-next-preview]'), null);
  assert.equal(win.document.querySelector('#blackbaud-next-assignment-previews'), null);
  resolveRequest?.(new Response(JSON.stringify({ UserInfo: { UserId: 42, DefaultPersonaId: 2 } })));
  await flush();
  assert.equal(win.document.querySelector('[role="dialog"]'), null);
  assert.equal(win.document.querySelectorAll('a').length, 1);
});

test('preview discovery ignores unrelated changes and follows in-place native titles and URLs', async (t) => {
  const win = fixture(nativeLink(123) + '<nav><span>Native navigation</span></nav>');
  mount();
  await flush();
  const root = win.document.querySelector<HTMLElement>('app-assignment-title-link')!;
  const query = root.querySelectorAll.bind(root);
  let reads = 0;
  t.mock.method(root, 'querySelectorAll', (selector: string) => { reads += 1; return query(selector); });
  win.document.querySelector('nav')!.classList.add('open');
  win.document.querySelector('nav span')!.textContent = 'Updated native navigation';
  win.document.body.insertAdjacentHTML('beforeend', '<aside>Unrelated status</aside>');
  await flush();
  assert.equal(reads, 0);
  const anchor = root.querySelector('a')!;
  anchor.firstChild!.nodeValue = 'Changed assignment';
  await flush();
  assert.ok(reads > 0);
  assert.equal(root.querySelector('button')!.getAttribute('aria-label'), 'Preview Changed assignment');
  anchor.href = '/lms-assignment/assignment/assignment-student-view/456';
  await flush();
  assert.equal(root.querySelectorAll('button').length, 1);
  anchor.href = '/unrelated-native-page';
  await flush();
  assert.equal(root.querySelector('button'), null);
});

test('preview readers briefly reuse validated identity and always fetch fresh assignment details', async (t) => {
  fixture('');
  let time = 0;
  let contexts = 0;
  let details = 0;
  const studentIds: string[] = [];
  t.mock.method(globalThis, 'fetch', async (path: RequestInfo | URL) => {
    if (String(path) === '/api/webapp/context') {
      contexts += 1;
      return new Response(JSON.stringify({ UserInfo: { UserId: 40 + contexts, DefaultPersonaId: 2 } }));
    }
    studentIds.push(new URL(String(path), window.location.href).searchParams.get('studentUserId')!);
    return new Response(JSON.stringify(assignment(123, `Fresh version ${++details}`)));
  });
  const reader = createAssignmentPreviewReader(() => time);
  const signal = new AbortController().signal;
  assert.equal((await reader.read(target(), signal)).title, 'Fresh version 1');
  time = ASSIGNMENT_PREVIEW_IDENTITY_LIFETIME - 1;
  assert.equal((await reader.read(target(), signal)).title, 'Fresh version 2');
  assert.equal(contexts, 1);
  time = ASSIGNMENT_PREVIEW_IDENTITY_LIFETIME;
  assert.equal((await reader.read(target(), signal)).title, 'Fresh version 3');
  assert.equal(contexts, 2);
  assert.deepEqual(studentIds, ['41', '41', '42']);
  reader.clear();
  await reader.read(target(), signal);
  assert.equal(contexts, 3);
  assert.equal(details, 4);
});

test('failed identity, detail and target validation invalidate identity before a retry', async (t) => {
  fixture('');
  let contexts = 0;
  let details = 0;
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (path: RequestInfo | URL) => {
    requests += 1;
    if (String(path) === '/api/webapp/context') {
      contexts += 1;
      return new Response(JSON.stringify({ UserInfo: { UserId: 42, DefaultPersonaId: contexts === 1 ? 1 : 2 } }));
    }
    return ++details === 1 ? new Response('Unavailable', { status: 503 }) : new Response(JSON.stringify(assignment()));
  });
  const reader = createAssignmentPreviewReader();
  const signal = new AbortController().signal;
  await assert.rejects(reader.read(target(), signal), /current student/);
  assert.equal(details, 0);
  await assert.rejects(reader.read(target(), signal), /503/);
  await reader.read(target(), signal);
  assert.equal(contexts, 3);
  const beforeInvalidTarget = requests;
  await assert.rejects(reader.read({ ...target(), detailsUrl: 'https://foreign.example/lms-assignment/assignment/assignment-student-view/123' }, signal), /invalid/);
  assert.equal(requests, beforeInvalidTarget);
  await reader.read(target(), signal);
  assert.equal(contexts, 4);
});

test('a canceled context read is not cached and cannot start an assignment read', async (t) => {
  fixture('');
  let contexts = 0;
  let details = 0;
  let resolveContext: ((response: Response) => void) | undefined;
  t.mock.method(globalThis, 'fetch', async (path: RequestInfo | URL) => {
    if (String(path) === '/api/webapp/context') {
      if (++contexts === 1) return new Promise<Response>((resolve) => { resolveContext = resolve; });
      return new Response(JSON.stringify({ UserInfo: { UserId: 77, DefaultPersonaId: 2 } }));
    }
    details += 1;
    assert.equal(new URL(String(path), window.location.href).searchParams.get('studentUserId'), '77');
    return new Response(JSON.stringify(assignment()));
  });
  const reader = createAssignmentPreviewReader();
  const controller = new AbortController();
  const pending = reader.read(target(), controller.signal);
  const canceled = assert.rejects(pending, { name: 'AbortError' });
  controller.abort();
  resolveContext?.(new Response(JSON.stringify({ UserInfo: { UserId: 42, DefaultPersonaId: 2 } })));
  await canceled;
  assert.equal(details, 0);
  await reader.read(target(), new AbortController().signal);
  assert.equal(contexts, 2);
  assert.equal(details, 1);
});

test('a late canceled read cannot discard the replacement read’s validated identity', async (t) => {
  fixture('');
  let contexts = 0;
  let resolveOld: ((response: Response) => void) | undefined;
  t.mock.method(globalThis, 'fetch', async (path: RequestInfo | URL) => {
    if (String(path) === '/api/webapp/context') {
      if (++contexts === 1) return new Promise<Response>((resolve) => { resolveOld = resolve; });
      return new Response(JSON.stringify({ UserInfo: { UserId: 77, DefaultPersonaId: 2 } }));
    }
    assert.equal(new URL(String(path), window.location.href).searchParams.get('studentUserId'), '77');
    return new Response(JSON.stringify(assignment()));
  });
  const reader = createAssignmentPreviewReader();
  const old = new AbortController();
  const canceled = assert.rejects(reader.read(target(), old.signal), { name: 'AbortError' });
  old.abort();
  await reader.read(target(), new AbortController().signal);
  resolveOld?.(new Response(JSON.stringify({ UserInfo: { UserId: 42, DefaultPersonaId: 2 } })));
  await canceled;
  await reader.read(target(), new AbortController().signal);
  assert.equal(contexts, 2);
});

test('preview reopening reuses identity while remounting obtains the current student again', async (t) => {
  const win = fixture(nativeLink(123));
  let contexts = 0;
  let details = 0;
  const studentIds: string[] = [];
  t.mock.method(globalThis, 'fetch', async (path: RequestInfo | URL) => {
    if (String(path) === '/api/webapp/context') {
      contexts += 1;
      return new Response(JSON.stringify({ UserInfo: { UserId: contexts === 1 ? 42 : 77, DefaultPersonaId: 2 } }));
    }
    studentIds.push(new URL(String(path), win.location.href).searchParams.get('studentUserId')!);
    return new Response(JSON.stringify(assignment(123, `Fresh version ${++details}`)));
  });
  const firstMount = mount();
  win.document.querySelector<HTMLButtonElement>('[data-blackbaud-next-preview]')!.click();
  await flush();
  win.document.querySelector<HTMLButtonElement>('[role="dialog"] button')!.click();
  win.document.querySelector<HTMLButtonElement>('[data-blackbaud-next-preview]')!.click();
  await flush();
  assert.equal(contexts, 1);
  assert.equal(win.document.querySelector('[role="dialog"] h2')!.textContent, 'Fresh version 2');
  firstMount.abort();
  mount();
  win.document.querySelector<HTMLButtonElement>('[data-blackbaud-next-preview]')!.click();
  await flush();
  assert.equal(contexts, 2);
  assert.equal(win.document.querySelector('[role="dialog"] h2')!.textContent, 'Fresh version 3');
  assert.deepEqual(studentIds, ['42', '42', '77']);
});
