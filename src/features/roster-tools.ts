import { ROSTER_PICKER_SELECTOR, createRosterReader, rosterPickerIdentity, rosterTargetFromPicker, rosterTargetFromRequest, rosterTargetFromUrl, rosterValues, rosterViewSelector } from '../blackbaud/roster.ts';
import type { RosterTarget } from '../blackbaud/roster.ts';
import { isLmsPage } from '../blackbaud/routes.ts';
import { createButton, watchAddedElements } from '../shared/dom.ts';
import type { Feature } from '../shared/types.ts';

export const rosterToolsFeature: Feature = {
  id: 'roster-tools',
  settingsKeys: [],
  enabled: (settings) => settings.rosterTools,
  matches: (url) => isLmsPage(url) && rosterTargetFromUrl(url) !== null,
  mount: ({ signal, url }) => watchAddedElements(rosterViewSelector(url), (root) =>
    watchAddedElements<HTMLElement>(ROSTER_PICKER_SELECTOR, (picker) => {
      const toolbar = document.createElement('div');
      toolbar.className = 'bn-tools';
      toolbar.dataset.blackbaudNextRoster = '1';
      toolbar.setAttribute('role', 'group');
      toolbar.setAttribute('aria-label', 'Roster tools');
      const names = createButton('Copy roster names', 'copy');
      const emails = createButton('Copy roster emails', 'copy');
      const status = document.createElement('span');
      status.className = 'bn-tool-status';
      status.setAttribute('role', 'status');
      toolbar.append(names, emails, status);
      picker.insertAdjacentElement('afterend', toolbar);

      const route = window.location.href;
      const initialTarget = rosterTargetFromUrl(new URL(route));
      let term = rosterPickerIdentity(picker);
      let termChanged = false;
      let since = performance.now();
      let latest: RosterTarget | null = null;
      let latestStart = -Infinity;
      const reader = createRosterReader();
      let activeCopy: object | null = null;
      let resetTimer: ReturnType<typeof setTimeout> | undefined;
      let disposed = false;

      const clearRequest = () => { reader.clear(); activeCopy = null; };
      const currentTarget = () => rosterTargetFromPicker(picker, new URL(window.location.href)) ?? latest ?? (termChanged ? null : initialTarget);
      const resetCopy = () => {
        clearRequest();
        clearTimeout(resetTimer);
        names.disabled = false;
        emails.disabled = false;
        status.textContent = '';
      };
      const selectionChanged = () => {
        const next = rosterPickerIdentity(picker);
        if (next === term) return;
        resetCopy();
        term = next;
        termChanged = true;
        since = performance.now();
        latest = null;
        latestStart = -Infinity;
      };
      picker.addEventListener('change', selectionChanged, true);

      // Observe only requests made while this roster and this term are active.
      // An old entry from another page in performance history is never a source.
      const observer = typeof PerformanceObserver === 'undefined' ? null : new PerformanceObserver((list) => {
        if (disposed || signal.aborted || window.location.href !== route) return;
        selectionChanged();
        for (const entry of list.getEntries()) {
          if (entry.startTime < since || entry.startTime < latestStart) continue;
          const target = rosterTargetFromRequest(entry.name, window.location.origin);
          const kind = initialTarget?.kind ?? (/^#athleticteam\//i.test(window.location.hash) ? 'team' : 'section');
          if (target?.kind === kind) {
            const previous = currentTarget();
            latest = target;
            latestStart = entry.startTime;
            const next = currentTarget();
            if (previous?.kind !== next?.kind || previous?.id !== next?.id) resetCopy();
          }
        }
      });
      observer?.observe({ type: 'resource' });

      const copy = async (type: 'name' | 'email') => {
        if (disposed || signal.aborted || window.location.href !== route) return;
        selectionChanged();
        const target = currentTarget();
        if (!target) {
          status.textContent = 'Roster unavailable. Open or reload the current roster and try again.';
          return;
        }
        clearTimeout(resetTimer);
        const request = {};
        activeCopy = request;
        const copiedTerm = term;
        names.disabled = true;
        emails.disabled = true;
        status.textContent = 'Loading roster…';
        const isCurrent = () => {
          const current = currentTarget();
          return !disposed && !signal.aborted && activeCopy === request && picker.isConnected &&
            window.location.href === route && rosterPickerIdentity(picker) === copiedTerm &&
            current?.kind === target.kind && current.id === target.id;
        };
        try {
          const roster = await reader.read(target, JSON.stringify([route, copiedTerm]));
          if (!isCurrent()) return;
          const values = rosterValues(roster, type);
          if (!values.length) throw new Error(type === 'email' ? 'This roster has no email addresses.' : 'This roster has no names.');
          await navigator.clipboard.writeText(values.join(', '));
          if (isCurrent()) status.textContent = `${type === 'email' ? 'Email addresses' : 'Names'} copied.`;
        } catch (error) {
          if (isCurrent()) status.textContent = error instanceof Error ? error.message : 'The roster could not be copied.';
        } finally {
          if (isCurrent()) {
            names.disabled = false;
            emails.disabled = false;
            resetTimer = setTimeout(() => { if (!disposed && !signal.aborted) status.textContent = ''; }, 4000);
          }
          if (activeCopy === request) activeCopy = null;
        }
      };
      const copyNames = () => { void copy('name'); };
      const copyEmails = () => { void copy('email'); };
      names.addEventListener('click', copyNames);
      emails.addEventListener('click', copyEmails);
      const cleanup = () => {
        disposed = true;
        clearRequest();
        clearTimeout(resetTimer);
        observer?.disconnect();
        picker.removeEventListener('change', selectionChanged, true);
        names.removeEventListener('click', copyNames);
        emails.removeEventListener('click', copyEmails);
        signal.removeEventListener('abort', cleanup);
        toolbar.remove();
      };
      signal.addEventListener('abort', cleanup, { once: true });
      return cleanup;
    }, signal, root, ['id']), signal, document, ['id']),
};
