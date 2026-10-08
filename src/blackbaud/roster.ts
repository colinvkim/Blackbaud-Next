export interface RosterTarget {
  kind: 'section' | 'team';
  id: string;
}

export interface RosterEntry {
  name: string;
  email: string;
}

export const ROSTER_PICKER_SELECTOR = '#roster-term-picker';
export const ROSTER_CACHE_LIFETIME = 15_000;

export function rosterViewSelector(url: URL): string {
  return /^#academicclass\//i.test(url.hash) ? '#academicclassmaincontainer' : '#site-main';
}

export function rosterPickerIdentity(picker: Element): string {
  if (picker instanceof HTMLSelectElement) {
    const option = picker.selectedOptions[0];
    return [picker.value, option?.dataset.termId, option?.dataset.sectionId, option?.dataset.teamId].join(':');
  }
  return [picker.getAttribute('data-value'), picker.getAttribute('data-section-id'), picker.getAttribute('data-team-id')].join(':');
}

export function rosterTargetFromPicker(picker: Element, url: URL): RosterTarget | null {
  const selected = picker instanceof HTMLSelectElement ? picker.selectedOptions[0] : null;
  // Native academic options identify the selected term's section, which can
  // differ from the section that originally opened this class page.
  if (picker instanceof HTMLSelectElement && picker.matches(ROSTER_PICKER_SELECTOR) &&
    /^#academicclass\/[1-9]\d*(?:\/|\?|$)/i.test(url.hash) && /^[1-9]\d*$/.test(picker.value)) {
    return { kind: 'section', id: picker.value };
  }
  const sectionId = selected?.dataset.sectionId ?? picker.getAttribute('data-section-id');
  const teamId = selected?.dataset.teamId ?? picker.getAttribute('data-team-id');
  if (sectionId && /^[1-9]\d*$/.test(sectionId) && !teamId) return { kind: 'section', id: sectionId };
  if (teamId && /^[1-9]\d*$/.test(teamId) && !sectionId) return { kind: 'team', id: teamId };
  return null;
}

function identifier(value: string | null | undefined): string | null {
  return value && /^[1-9]\d*$/.test(value) ? value : null;
}

// Only route segments whose meaning is known may identify a roster. A number
// elsewhere in the hash can be a student, school, or duration identifier.
export function rosterTargetFromUrl(url: URL): RosterTarget | null {
  const hash = url.hash.replace(/^#/, '');
  const section = hash.match(/^(?:academicclass|academics\/section)\/([1-9]\d*)(?:\/|\?|$)/i);
  if (section?.[1]) return { kind: 'section', id: section[1] };
  const team = hash.match(/^athleticteam\/([1-9]\d*)(?:\/|\?|$)/i);
  if (team?.[1]) return { kind: 'team', id: team[1] };
  if (/\/roster(?:\/|$)/i.test(url.pathname)) {
    const sectionId = identifier(url.searchParams.get('sectionId'));
    const teamId = identifier(url.searchParams.get('teamId'));
    if (sectionId && !teamId) return { kind: 'section', id: sectionId };
    if (teamId && !sectionId) return { kind: 'team', id: teamId };
  }
  return null;
}

export function rosterTargetFromRequest(request: string, origin: string): RosterTarget | null {
  try {
    const url = new URL(request, origin);
    if (url.origin !== origin) return null;
    const section = url.pathname.match(/^\/api\/datadirect\/sectionrosterget\/([1-9]\d*)\/?$/i);
    if (section?.[1]) return { kind: 'section', id: section[1] };
    if (/^\/api\/datadirect\/athleticrosterget\/?$/i.test(url.pathname)) {
      const id = identifier(url.searchParams.get('teamId'));
      if (id) return { kind: 'team', id };
    }
  } catch {
    // Unknown or malformed request URLs are not roster identifiers.
  }
  return null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeRoster(payload: unknown): RosterEntry[] {
  if (!Array.isArray(payload)) throw new Error('The roster response has an unsupported format.');
  return payload.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    const name = text(record.name) || text(record.formatted_name) ||
      [text(record.firstName), text(record.lastName)].filter(Boolean).join(' ');
    const email = text(record.email);
    return name || email ? [{ name, email }] : [];
  });
}

export function rosterValues(entries: RosterEntry[], type: 'name' | 'email'): string[] {
  const seen = new Set<string>();
  return entries.flatMap((entry) => {
    const value = entry[type].trim();
    if (!value || (type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) return [];
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);
    return [value];
  });
}

export async function fetchRoster(target: RosterTarget, signal: AbortSignal): Promise<RosterEntry[]> {
  if (!identifier(target.id)) throw new Error('The roster identifier is invalid.');
  const path = target.kind === 'team'
    ? `/api/datadirect/athleticrosterget/?format=json&teamId=${target.id}`
    : `/api/datadirect/sectionrosterget/${target.id}/?format=json`;
  const response = await fetch(path, { credentials: 'same-origin', signal, headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`The roster could not be loaded (${response.status}).`);
  return normalizeRoster(await response.json());
}

// One mounted roster owns one bounded read. Both copy actions can reuse the
// request/result, while a changed term or route discards it rather than keeping
// school data in storage or a cross-page cache.
export function createRosterReader(now = () => performance.now()) {
  type Read = { key: string; controller: AbortController; promise: Promise<RosterEntry[]>; expiresAt: number | null };
  let current: Read | null = null;
  const clear = () => {
    current?.controller.abort();
    current = null;
  };
  const read = (target: RosterTarget, identity: string): Promise<RosterEntry[]> => {
    const key = JSON.stringify([identity, target.kind, target.id]);
    if (current?.key === key && (current.expiresAt === null || current.expiresAt > now())) return current.promise;
    clear();
    const controller = new AbortController();
    const entry: Read = { key, controller, expiresAt: null, promise: Promise.resolve([]) };
    current = entry;
    entry.promise = fetchRoster(target, controller.signal).then((roster) => {
      if (controller.signal.aborted) throw controller.signal.reason;
      if (current === entry) entry.expiresAt = now() + ROSTER_CACHE_LIFETIME;
      return roster;
    }, (error: unknown) => {
      if (current === entry) current = null;
      throw error;
    });
    return entry.promise;
  };
  return { read, clear };
}
