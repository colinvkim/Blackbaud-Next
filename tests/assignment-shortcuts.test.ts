import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { assignmentShortcutDate, assignmentTitleLinkUrl, isFinishedAssignmentStatus, localAssignmentDate, parseAssignmentDate, readAssignmentRows } from '../src/blackbaud/assignment-list.ts';
import { assignmentShortcutsFeature } from '../src/features/assignment-shortcuts.ts';
import { DEFAULT_SETTINGS } from '../src/shared/settings.ts';

const hiddenAttribute = 'data-blackbaud-next-shortcut-hidden';
let dom: JSDOM | undefined;
let restore = () => {};
const cleanups: Array<() => void> = [];

function fixture(html: string) {
  dom = new JSDOM(html, { url: 'https://example.myschoolapp.com/lms-assignment/assignment-center/student' });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, MutationObserver: dom.window.MutationObserver })) {
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

function row(id: number, due: string, status = 'To do', extra = ''): string {
  return `<sky-repeater-item class="assignment-repeater-item sky-repeater-item-group-7" ${extra}><div class="sky-repeater-item" role="row"><div class="sky-repeater-item-header"><div><app-assignment-title-link><a href="/lms-assignment/assignment/assignment-student-view/${id}">Assignment ${id}</a></app-assignment-title-link></div><div class="assignment-center-middle-block"><div class="assignment-details sky-font-deemphasized"><span>Due: ${due} 8:30 AM | </span><span>Assigned: 10/1/2026 8:00 AM | </span><span>10 pts | </span><span>Class</span></div><app-assignment-status-display><button>${status}</button></app-assignment-status-display></div></div></div></sky-repeater-item>`;
}

function group(id: string, rows: string, extra = ''): string {
  return `<sky-repeater-item id="${id}" class="sky-repeater-item-group-1" ${extra}><div class="sky-repeater-item-header"><h3>Native date group</h3></div><div class="sky-repeater-item-body">${rows}</div></sky-repeater-item>`;
}

function nativeToolbar(): string {
  return '<div class="hide-for-print"><sky-toolbar><input aria-label="Search items"></sky-toolbar></div>';
}

function mount() {
  const controller = new AbortController();
  const cleanup = assignmentShortcutsFeature.mount({ url: new URL(window.location.href), signal: controller.signal, settings: DEFAULT_SETTINGS });
  cleanups.push(() => { controller.abort(); cleanup?.(); });
  return { controller, cleanup };
}

function click(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('.bn-assignment-shortcuts button')].find((control) => control.textContent === label);
  assert.ok(button, `Missing ${label} shortcut`);
  button.click();
  return button;
}

async function flush() {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  dom?.window.close();
  dom = undefined;
  restore();
  restore = () => {};
});

test('assignment dates use explicit local calendar dates and reject invalid values', () => {
  assert.equal(parseAssignmentDate('Wed, October 7, 2026'), '2026-10-07');
  assert.equal(parseAssignmentDate('10/7/2026 11:59 PM'), '2026-10-07');
  assert.equal(parseAssignmentDate('2026-10-07T00:00:00Z'), '2026-10-07');
  assert.equal(parseAssignmentDate('Feb 29, 2028'), '2028-02-29');
  assert.equal(parseAssignmentDate('Feb 29, 2027'), null);
  assert.equal(parseAssignmentDate('13/7/2026'), null);
  assert.equal(parseAssignmentDate('Oct 7'), null);
  assert.equal(parseAssignmentDate('Tomorrow'), null);
});

test('today and tomorrow follow local calendar rollover rather than a 24 hour duration', () => {
  const now = new Date(2026, 11, 31, 23, 55);
  assert.equal(localAssignmentDate(now), '2026-12-31');
  assert.equal(assignmentShortcutDate('today', now), '2026-12-31');
  assert.equal(assignmentShortcutDate('tomorrow', now), '2027-01-01');
  assert.equal(assignmentShortcutDate('unfinished', now), null);
});

test('only native same-origin assignment detail links provide row identities', () => {
  const dom = new JSDOM('<a></a>', { url: 'https://example.myschoolapp.com/lms-assignment/assignment-center/student' });
  const anchor = dom.window.document.querySelector('a')!;
  try {
    anchor.href = '/lms-assignment/assignment/assignment-student-view/123';
    assert.equal(assignmentTitleLinkUrl(anchor)?.pathname, '/lms-assignment/assignment/assignment-student-view/123');
    anchor.href = 'https://other.example/lms-assignment/assignment/assignment-student-view/123';
    assert.equal(assignmentTitleLinkUrl(anchor), null);
    anchor.href = '/lms-assignment/assignment/assignment-student-view/123-other';
    assert.equal(assignmentTitleLinkUrl(anchor), null);
    anchor.href = 'javascript:alert(1)';
    assert.equal(assignmentTitleLinkUrl(anchor), null);
  } finally {
    dom.window.close();
  }
});

test('assignment row titles normalize literal formatted strings without rewriting native title content', () => {
  fixture(row(123, '10/7/2026'));
  const link = document.querySelector<HTMLAnchorElement>('app-assignment-title-link a')!;
  const richTitle = '<span style="font-weight:400;">Read Example&#8211;&#8220;The Distant Shore&#8221;</span>';
  link.textContent = richTitle;
  assert.equal(readAssignmentRows(document)[0]!.title, 'Read Example–“The Distant Shore”');
  assert.equal(link.textContent, richTitle);
  link.textContent = 'Use Array<T> &amp; Map<K,V>';
  assert.equal(readAssignmentRows(document)[0]!.title, 'Use Array<T> & Map<K,V>');
  assert.equal(link.textContent, 'Use Array<T> &amp; Map<K,V>');
});

test('unfinished filtering retains unknown native statuses', () => {
  assert.equal(isFinishedAssignmentStatus('Completed'), true);
  assert.equal(isFinishedAssignmentStatus('Submitted'), true);
  assert.equal(isFinishedAssignmentStatus('Graded'), true);
  assert.equal(isFinishedAssignmentStatus('To do'), false);
  assert.equal(isFinishedAssignmentStatus('Missing'), false);
  assert.equal(isFinishedAssignmentStatus('Resubmit'), false);
  assert.equal(isFinishedAssignmentStatus(''), false);
});

test('rendered row metadata uses the Due field rather than the Assigned date', () => {
  fixture(nativeToolbar() + group('today', row(123, '10/7/2026', 'Completed') + row(456, 'unknown', 'To do')));
  const rows = readAssignmentRows(document);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.dueDate, '2026-10-07');
  assert.equal(rows[0]!.group?.id, 'today');
  assert.equal(rows[0]!.finished, true);
  assert.equal(rows[1]!.dueDate, null);
});

test('shortcuts preserve native controls and restore filtered rows and groups on cleanup', () => {
  fixture(nativeToolbar() + group('done', row(123, '10/7/2026', 'Completed')) + group('todo', row(456, '10/8/2026')));
  const { cleanup } = mount();
  const toolbar = document.querySelector('.bn-assignment-shortcuts')!;
  assert.equal(toolbar.previousElementSibling?.tagName, 'SKY-TOOLBAR');
  assert.equal(click('Unfinished').getAttribute('aria-pressed'), 'true');
  assert.equal(document.querySelector('#done')!.getAttribute(hiddenAttribute), 'true');
  assert.equal(document.querySelector('#todo')!.getAttribute(hiddenAttribute), null);
  assert.match(toolbar.textContent ?? '', /Showing 1 of 2 loaded assignments/);
  assert.equal(document.querySelector('app-assignment-status-display button')!.textContent, 'Completed');
  click('All loaded');
  assert.equal(document.querySelectorAll(`[${hiddenAttribute}]`).length, 0);
  click('Unfinished');
  cleanup?.();
  assert.equal(document.querySelector('.bn-assignment-shortcuts'), null);
  assert.equal(document.querySelectorAll(`[${hiddenAttribute}]`).length, 0);
  assert.ok(document.querySelector('sky-toolbar input[aria-label="Search items"]'));
});

test('late native controls, rows and toolbar replacements retain the active shortcut without duplicate UI', async () => {
  fixture('<main></main>');
  const { controller } = mount();
  document.querySelector('main')!.innerHTML = nativeToolbar() + group('native', row(123, '10/7/2026', 'Completed'));
  await flush();
  click('Unfinished');
  assert.match(document.querySelector('.bn-tool-status')!.textContent ?? '', /Showing 0 of 1 loaded assignments\. No matches/);
  document.querySelector('.sky-repeater-item-body')!.insertAdjacentHTML('beforeend', row(456, '10/8/2026'));
  await flush();
  assert.match(document.querySelector('.bn-tool-status')!.textContent ?? '', /Showing 1 of 2 loaded assignments/);
  document.querySelector('main')!.innerHTML = nativeToolbar() + group('replacement', row(789, '10/9/2026') + row(999, '10/9/2026', 'Completed'));
  await flush();
  assert.equal(document.querySelectorAll('.bn-assignment-shortcuts').length, 1);
  assert.equal(document.querySelector('.bn-assignment-shortcuts button[aria-pressed="true"]')!.textContent, 'Unfinished');
  assert.match(document.querySelector('.bn-tool-status')!.textContent ?? '', /Showing 1 of 2 loaded assignments/);
  controller.abort();
  assert.equal(document.querySelector('.bn-assignment-shortcuts'), null);
  assert.equal(document.querySelectorAll(`[${hiddenAttribute}]`).length, 0);
  document.querySelector('main')!.innerHTML = nativeToolbar() + group('late', row(333, '10/10/2026'));
  await flush();
  assert.equal(document.querySelector('.bn-assignment-shortcuts'), null);
});

test('native hidden rows and collapsed groups stay hidden when shortcuts change', () => {
  fixture(nativeToolbar() + group('open', row(123, '10/7/2026') + row(456, '10/7/2026', 'To do', 'style="display:none"')) + group('collapsed', row(789, '10/8/2026'), 'hidden'));
  mount();
  click('Unfinished');
  assert.match(document.querySelector('.bn-tool-status')!.textContent ?? '', /Showing 1 of 1 loaded assignments/);
  click('All loaded');
  assert.ok(document.querySelector('#collapsed')!.hasAttribute('hidden'));
  assert.equal(document.querySelectorAll<HTMLElement>('.assignment-repeater-item')[1]!.style.display, 'none');
  assert.equal(document.querySelectorAll(`[${hiddenAttribute}]`).length, 0);
});

test('native status changes and local midnight refresh the chosen shortcut', async (t) => {
  const start = new Date(2026, 9, 7, 23, 59, 59);
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: start });
  fixture(nativeToolbar() + group('today', row(123, '10/7/2026')) + group('tomorrow', row(456, '10/8/2026', 'Completed')));
  mount();
  click('Due today');
  assert.equal(document.querySelector('#today')!.getAttribute(hiddenAttribute), null);
  assert.equal(document.querySelector('#tomorrow')!.getAttribute(hiddenAttribute), 'true');
  t.mock.timers.tick(1000);
  assert.equal(document.querySelector('#today')!.getAttribute(hiddenAttribute), 'true');
  assert.equal(document.querySelector('#tomorrow')!.getAttribute(hiddenAttribute), null);
  click('Unfinished');
  document.querySelector('#tomorrow app-assignment-status-display button')!.firstChild!.nodeValue = 'To do';
  await flush();
  assert.match(document.querySelector('.bn-tool-status')!.textContent ?? '', /Showing 2 of 2 loaded assignments/);
  click('Due tomorrow');
  assert.match(document.querySelector('.bn-tool-status')!.textContent ?? '', /Showing 0 of 2 loaded assignments\. No matches/);
});

test('unrelated page updates do not reread assignment metadata, while changed rows still refresh', async (t) => {
  fixture(nativeToolbar() + group('native', row(123, '10/7/2026', 'Completed')) + '<nav><span>Native navigation</span></nav>');
  mount();
  await flush();
  click('Unfinished');
  const assignment = document.querySelector<HTMLElement>('.assignment-repeater-item')!;
  const query = assignment.querySelectorAll.bind(assignment);
  let reads = 0;
  t.mock.method(assignment, 'querySelectorAll', (selector: string) => { reads += 1; return query(selector); });
  document.querySelector('nav')!.classList.add('open');
  document.querySelector('nav span')!.textContent = 'Updated native navigation';
  document.body.insertAdjacentHTML('beforeend', '<aside>Unrelated status</aside>');
  await flush();
  assert.equal(reads, 0);
  assert.match(document.querySelector('.bn-tool-status')!.textContent ?? '', /Showing 0 of 1 loaded assignments/);
  assignment.querySelector('app-assignment-status-display button')!.firstChild!.nodeValue = 'To do';
  await flush();
  assert.ok(reads > 0);
  assert.match(document.querySelector('.bn-tool-status')!.textContent ?? '', /Showing 1 of 1 loaded assignments/);
});

test('delayed toolbar controls and multiple toolbars share one filter and accurate native totals', async () => {
  fixture('<sky-toolbar></sky-toolbar>' + group('done', row(123, '10/7/2026', 'Completed')) + group('todo', row(456, '10/8/2026')));
  mount();
  assert.equal(document.querySelector('.bn-assignment-shortcuts'), null);
  document.querySelector('sky-toolbar')!.innerHTML = '<input aria-label="Search items">';
  document.body.insertAdjacentHTML('beforeend', nativeToolbar());
  await flush();
  assert.equal(document.querySelectorAll('.bn-assignment-shortcuts').length, 2);
  click('Unfinished');
  for (const toolbar of document.querySelectorAll('.bn-assignment-shortcuts')) {
    assert.equal(toolbar.querySelector('button[aria-pressed="true"]')!.textContent, 'Unfinished');
    assert.match(toolbar.querySelector('.bn-tool-status')!.textContent ?? '', /Showing 1 of 2 loaded assignments/);
  }
});

test('native group moves update row ownership and hidden ancestors without replacing the assignment', async () => {
  fixture(nativeToolbar() + group('first', row(123, '10/7/2026', 'Completed')) + group('second', row(456, '10/8/2026')));
  mount();
  click('Unfinished');
  const assignment = document.querySelector<HTMLElement>('#first .assignment-repeater-item')!;
  document.querySelector('#second .sky-repeater-item-body')!.append(assignment);
  await flush();
  assert.equal(assignment.getAttribute(hiddenAttribute), 'true');
  assert.equal(document.querySelector('#first')!.getAttribute(hiddenAttribute), null);
  const second = document.querySelector<HTMLElement>('#second')!;
  second.hidden = true;
  await flush();
  assert.match(document.querySelector('.bn-tool-status')!.textContent ?? '', /Showing 0 of 0 loaded assignments/);
});

test('shortcut cleanup restores original markers and preserves newer native values', () => {
  fixture(nativeToolbar() + group('done', row(123, '10/7/2026', 'Completed', `${hiddenAttribute}="row-original"`) + row(456, '10/7/2026', 'Completed'), `${hiddenAttribute}="group-original"`));
  const { cleanup } = mount();
  click('Unfinished');
  const rows = document.querySelectorAll<HTMLElement>('.assignment-repeater-item');
  assert.equal(rows[0]!.getAttribute(hiddenAttribute), 'true');
  assert.equal(rows[1]!.getAttribute(hiddenAttribute), 'true');
  rows[1]!.setAttribute(hiddenAttribute, 'native-update');
  cleanup?.();
  assert.equal(rows[0]!.getAttribute(hiddenAttribute), 'row-original');
  assert.equal(rows[1]!.getAttribute(hiddenAttribute), 'native-update');
  assert.equal(document.querySelector('#done')!.getAttribute(hiddenAttribute), 'group-original');
  assert.equal(document.querySelector('.bn-assignment-shortcuts'), null);
});

test('toolbar matching follows changes to native search accessibility labels and repairs removed UI', async () => {
  fixture(nativeToolbar() + group('todo', row(123, '10/7/2026')));
  mount();
  const search = document.querySelector<HTMLInputElement>('sky-toolbar input')!;
  search.setAttribute('aria-label', 'Different search');
  await flush();
  assert.equal(document.querySelector('.bn-assignment-shortcuts'), null);
  search.setAttribute('aria-label', 'Search items');
  await flush();
  const toolbar = document.querySelector('.bn-assignment-shortcuts')!;
  assert.ok(toolbar);
  toolbar.remove();
  await flush();
  assert.equal(document.querySelector('.bn-assignment-shortcuts'), toolbar);
  assert.match(toolbar.textContent ?? '', /Showing 1 of 1 loaded assignments/);
});
