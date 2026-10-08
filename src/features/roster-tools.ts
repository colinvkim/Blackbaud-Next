import { fetchRoster, rosterTargetFromRequest, rosterTargetFromUrl, rosterValues } from '../blackbaud/roster.ts';
import type { RosterTarget } from '../blackbaud/roster.ts';
import { isLmsPage } from '../blackbaud/routes.ts';
import { createButton, watchElements } from '../shared/dom.ts';
import type { Feature } from '../shared/types.ts';

function pickerIdentity(picker: Element): string {
  if (picker instanceof HTMLSelectElement) {
    const option = picker.selectedOptions[0];
    return [picker.value, option?.dataset.termId, option?.dataset.sectionId, option?.dataset.teamId].join(':');
  }
  return [picker.getAttribute('data-value'), picker.getAttribute('data-section-id'), picker.getAttribute('data-team-id')].join(':');
}

function targetFromPicker(picker: Element, url: URL): RosterTarget | null {
  const selected = picker instanceof HTMLSelectElement ? picker.selectedOptions[0] : null;
  // Native academic roster options carry the selected term's section ID in
  // their value. It can differ from the initial section in the hash.
  if (picker instanceof HTMLSelectElement && picker.id === 'roster-term-picker' &&
    /^#academicclass\/[1-9]\d*(?:\/|\?|$)/i.test(url.hash) && /^[1-9]\d*$/.test(picker.value)) {
    return { kind: 'section', id: picker.value };
  }
  const sectionId = selected?.dataset.sectionId ?? picker.getAttribute('data-section-id');
  const teamId = selected?.dataset.teamId ?? picker.getAttribute('data-team-id');
  if (sectionId && /^[1-9]\d*$/.test(sectionId) && !teamId) return { kind: 'section', id: sectionId };
  if (teamId && /^[1-9]\d*$/.test(teamId) && !sectionId) return { kind: 'team', id: teamId };
  return null;
}

export const rosterToolsFeature: Feature = {
  id: 'roster-tools',
  enabled: (settings) => settings.rosterTools,
  matches: isLmsPage,
  mount: ({ signal }) => watchElements<HTMLElement>('#roster-term-picker', (picker) => {
    const toolbar = document.createElement('div');
    toolbar.className = 'bn-tools';
    toolbar.dataset.blackbaudNextRoster = '1';
    toolbar.setAttribute('role', 'group');
    toolbar.setAttribute('aria-label', 'Roster tools');
    const names = createButton('Copy roster names');
    const emails = createButton('Copy roster emails');
    const status = document.createElement('span');
    status.className = 'bn-tool-status';
    status.setAttribute('role', 'status');
    toolbar.append(names, emails, status);
    picker.insertAdjacentElement('afterend', toolbar);

    const route = window.location.href;
    const initialTarget = rosterTargetFromUrl(new URL(route));
    let term = pickerIdentity(picker);
    let termChanged = false;
    let since = performance.now();
    let latest: RosterTarget | null = null;
    let latestStart = -Infinity;
    let activeRequest: AbortController | null = null;
    let resetTimer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const clearRequest = () => { activeRequest?.abort(); activeRequest = null; };
    const selectionChanged = () => {
      const next = pickerIdentity(picker);
      if (next === term) return;
      clearRequest();
      term = next;
      termChanged = true;
      since = performance.now();
      latest = null;
      latestStart = -Infinity;
      names.disabled = false;
      emails.disabled = false;
      status.textContent = '';
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
          latest = target;
          latestStart = entry.startTime;
        }
      }
    });
    observer?.observe({ type: 'resource' });

    const copy = async (type: 'name' | 'email') => {
      if (disposed || signal.aborted || window.location.href !== route) return;
      selectionChanged();
      const target = targetFromPicker(picker, new URL(window.location.href)) ?? latest ?? (termChanged ? null : initialTarget);
      if (!target) {
        status.textContent = 'Roster unavailable. Open or reload the current roster and try again.';
        return;
      }
      clearRequest();
      clearTimeout(resetTimer);
      const request = new AbortController();
      activeRequest = request;
      const copiedTerm = term;
      names.disabled = true;
      emails.disabled = true;
      status.textContent = 'Loading roster…';
      const isCurrent = () => !disposed && !signal.aborted && !request.signal.aborted &&
        window.location.href === route && pickerIdentity(picker) === copiedTerm;
      try {
        const roster = await fetchRoster(target, request.signal);
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
        if (activeRequest === request) activeRequest = null;
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
  }, signal),
};
