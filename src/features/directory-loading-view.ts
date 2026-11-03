import { markOwned } from '../shared/dom.ts';
import { createIcon } from '../shared/icons.ts';
import { THEME_TOKENS } from '../shared/theme.ts';
import type { DirectoryLayout } from '../shared/directory-layout.ts';
import { directoryStyles } from './directory-styles.ts';

const loadingStyles = `
${THEME_TOKENS.replace('html {', '.bn-directory-loading {')}
.bn-directory.bn-directory-loading { box-sizing: border-box; padding: 20px; border: 1px solid var(--bn-border); border-radius: var(--bn-radius-lg); background: var(--bn-surface); }
.bn-directory-loading .bn-directory-controls { opacity: .65; }
.bn-directory-skeleton-list { animation: bn-directory-pulse 2s ease-in-out infinite; }
.bn-directory-skeleton-row { min-height: 104px; }
.bn-directory-skeleton-avatar { flex: 0 0 48px; height: 48px; border-radius: 50%; background: var(--bn-border); }
.bn-directory-skeleton-person { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 10px; padding-top: 5px; }
.bn-directory-skeleton-line { display: block; width: 46%; max-width: 140px; height: 10px; border-radius: 4px; background: var(--bn-border); }
.bn-directory-skeleton-line:first-child { width: 62%; max-width: 180px; height: 13px; }
.bn-directory-skeleton-line:last-child { width: 35%; max-width: 100px; opacity: .6; }
.bn-directory-skeleton-list[data-view="rows"] .bn-directory-skeleton-row:last-child { display: none; }
.bn-directory-recovery { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 8px; margin-top: 12px; color: var(--bn-muted); font-size: 13px; }
@keyframes bn-directory-pulse { 50% { opacity: .55; } }
@media (prefers-reduced-motion: reduce) { .bn-directory-skeleton-list { animation: none; } }
@media (max-width: 480px) { .bn-directory.bn-directory-loading { padding: 16px; } }
`;

// A shell can render before the isolated UI bundle or native styles are ready.
// Keep its styles inside the owned panel so removal also ends its animations.
export function createDirectoryLoadingView(page: Document, layout: DirectoryLayout = 'columns'): HTMLElement {
  const panel = markOwned(page.createElement('section'));
  panel.className = 'bn-directory bn-directory-loading';
  panel.setAttribute('aria-label', 'Directory loading');
  const style = page.createElement('style');
  style.textContent = directoryStyles + loadingStyles;
  const heading = page.createElement('div');
  heading.className = 'bn-directory-heading';
  heading.setAttribute('aria-hidden', 'true');
  const controls = page.createElement('div');
  controls.className = 'bn-directory-controls';
  for (const text of ['Search people', 'Grade', 'Sort by']) {
    const field = page.createElement('label');
    field.className = 'bn-directory-field';
    const caption = page.createElement('span');
    caption.textContent = text;
    const control = text === 'Search people' ? page.createElement('input') : page.createElement('select');
    control.disabled = true;
    if (control.tagName === 'INPUT') {
      const input = control as HTMLInputElement;
      input.type = 'search';
      input.placeholder = 'First, last, or preferred name';
      caption.className = 'bn-icon-label';
      caption.prepend(createIcon('search', page));
    } else {
      const option = page.createElement('option');
      option.textContent = '—';
      control.append(option);
    }
    field.append(caption, control);
    controls.append(field);
  }
  heading.append(controls);
  const results = page.createElement('div');
  results.className = 'bn-directory-results-bar';
  const message = page.createElement('p');
  message.className = 'bn-directory-count';
  message.setAttribute('role', 'status');
  message.textContent = 'Loading people…';
  const views = page.createElement('div');
  views.className = 'bn-directory-views';
  views.setAttribute('aria-hidden', 'true');
  for (const [text, icon] of [['Columns', 'columns-2'], ['Rows', 'rows-3']] as const) {
    const button = page.createElement('button');
    button.type = 'button';
    button.className = 'bn-button';
    button.disabled = true;
    button.append(createIcon(icon, page), page.createTextNode(text));
    views.append(button);
  }
  results.append(message, views);
  const list = page.createElement('ul');
  list.className = 'bn-directory-list bn-directory-skeleton-list';
  list.setAttribute('aria-hidden', 'true');
  for (let index = 0; index < 4; index += 1) {
    const row = page.createElement('li');
    row.className = 'bn-directory-row bn-directory-skeleton-row';
    const avatar = page.createElement('span');
    avatar.className = 'bn-directory-skeleton-avatar';
    const person = page.createElement('div');
    person.className = 'bn-directory-skeleton-person';
    for (let line = 0; line < 3; line += 1) {
      const bar = page.createElement('span');
      bar.className = 'bn-directory-skeleton-line';
      person.append(bar);
    }
    row.append(avatar, person);
    list.append(row);
  }
  const recovery = page.createElement('div');
  recovery.className = 'bn-directory-recovery';
  const slow = page.createElement('span');
  slow.textContent = 'Taking longer than usual.';
  const original = page.createElement('button');
  original.type = 'button';
  original.className = 'bn-button bn-directory-original';
  original.textContent = 'Use original directory';
  recovery.append(slow, original);
  panel.append(style, heading, results, list, recovery);
  applyDirectoryLoadingLayout(panel, layout);
  return panel;
}

export function applyDirectoryLoadingLayout(panel: Element, layout: DirectoryLayout): void {
  const list = panel.querySelector<HTMLElement>('.bn-directory-skeleton-list');
  if (list) list.dataset.view = layout;
  const buttons = panel.querySelectorAll('.bn-directory-views button');
  buttons[0]?.setAttribute('aria-pressed', String(layout === 'columns'));
  buttons[1]?.setAttribute('aria-pressed', String(layout === 'rows'));
}
