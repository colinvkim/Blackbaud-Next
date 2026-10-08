export interface RosterTarget {
  kind: 'section' | 'team';
  id: string;
}

export interface RosterEntry {
  name: string;
  email: string;
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
