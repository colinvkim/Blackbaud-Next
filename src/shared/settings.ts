import { extensionApi } from './extension.ts';
import { requestCoordinator } from './coordinator.ts';
import type { Cleanup } from './types.ts';

export const FEATURE_DEFINITIONS = [
  { key: 'pageAppearance', label: 'Page appearance', description: 'Restyle navigation and supported pages, including courses, assignments, and rosters.', defaultValue: true },
  { key: 'helpfulTabTitles', label: 'Descriptive tab titles', description: 'Identify the course, assignment, or page in each browser tab.', defaultValue: true },
  { key: 'fixFavicon', label: 'Blackbaud tab icon', description: 'Replace the school portal’s tab icon with the Blackbaud icon.', defaultValue: true },
  { key: 'automaticLogin', label: 'Automatic Google sign-in', description: 'Continue through Blackbaud and select your school Google account. Passwords and authentication challenges stay manual.', defaultValue: true },
  { key: 'optimizeLoginPage', legacyKey: 'loginFix', label: 'School sign-in page', description: 'Replace the initial school login form with a Google sign-in button.', defaultValue: true },
  { key: 'loadingOverlay', legacyKey: 'loadBetweenPages', label: 'Sign-in status messages', description: 'Show progress and a Continue manually action during automatic Google sign-in.', defaultValue: true },
  { key: 'assignmentShortcuts', label: 'Assignment shortcuts', description: 'Filter loaded assignments to unfinished work or assignments due today and tomorrow.', defaultValue: true },
  { key: 'assignmentPreviews', label: 'Assignment previews', description: 'Read instructions and open attachments beside the assignment list.', defaultValue: true },
  { key: 'assignmentCompletion', label: 'Completion checkboxes', description: 'Mark assignments completed or to do from the modern Assignment Center.', defaultValue: true },
  { key: 'assignmentStatusLabels', legacyKey: 'assignmentCompletion', label: 'Assignment status labels', description: 'Show clearer Graded, Missing, and In progress labels in the modern Assignment Center.', defaultValue: true },
  { key: 'assignmentReturnLink', label: 'Assignment return link', description: 'Make the Assignments link on an assignment page open Assignment Center.', defaultValue: true },
  { key: 'prepareAssignmentCenter', label: 'Preload Assignment Center', description: 'Prepare the modern Assignment Center from Schedule or when you hover over or focus its link.', defaultValue: true },
  { key: 'fixInvalidPages', legacyKey: 'fixBrokenAssignmentCenter', label: 'Stalled assignment recovery', description: 'Offer a reload action when the modern Assignment Center stays loading.', defaultValue: true },
  { key: 'classSearch', legacyKey: 'classSwitching', label: 'Classes search', description: 'Filter the Classes menu by class name.', defaultValue: true },
  { key: 'classSwitching', label: 'Remember class tab', description: 'Keep Assignments or Roster open when switching classes.', defaultValue: true },
  { key: 'rosterTools', legacyKey: 'copyRosterTools', label: 'Roster copy buttons', description: 'Copy roster names or email addresses in one click.', defaultValue: true },
  { key: 'enhancedDirectory', label: 'Directory redesign', description: 'Browse supported directories with search, sorting, contact details, and Columns or Rows views.', defaultValue: true },
  { key: 'downloadFullAvatar', label: 'Full-size profile photos', description: 'Add an option to open the original photo from a directory profile.', defaultValue: true },
  { key: 'resourceSearch', label: 'Resource Board search', description: 'Find resource cards by name or description.', defaultValue: true },
  { key: 'classicAssignmentCenter', label: 'Classic Assignment Center view', description: 'Add the native classic Assignment Center beside Calendar and List, and remember your last chosen view.', defaultValue: true },
] as const;

export type FeatureKey = typeof FEATURE_DEFINITIONS[number]['key'];
export type EnhancementMode = 'essentials' | 'full';
export type Settings = { schemaVersion: 2; enabled: boolean; mode: EnhancementMode; accountPreference: string } & Record<FeatureKey, boolean>;

const essentialFeatures = new Set<FeatureKey>(['automaticLogin', 'optimizeLoginPage', 'loadingOverlay', 'assignmentPreviews']);

export function effectiveSettings(settings: Settings): Settings {
  if (settings.mode !== 'essentials') return settings;
  return { ...settings, ...Object.fromEntries(FEATURE_DEFINITIONS.map(({ key }) => [key, essentialFeatures.has(key)])) };
}

export function isFullCustomized(settings: Settings): boolean {
  return FEATURE_DEFINITIONS.some(({ key, defaultValue }) => settings[key] !== defaultValue);
}

export function fullDefaults(): Record<FeatureKey, boolean> {
  return Object.fromEntries(FEATURE_DEFINITIONS.map(({ key, defaultValue }) => [key, defaultValue])) as Record<FeatureKey, boolean>;
}

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: 2,
  enabled: true,
  mode: 'full',
  accountPreference: '',
  ...fullDefaults(),
};

export function normalizeAccountPreference(value: unknown): string {
  if (typeof value !== 'string') return '';
  const preference = value.trim().toLowerCase().replace(/^@/, '');
  // Accept an email address or its domain. Never accept partial substring matches.
  return /^(?:[^\s@]+@)?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(preference) ? preference : '';
}

export function normalizeSettings(raw: Record<string, unknown> = {}): Settings {
  const settings = {
    ...DEFAULT_SETTINGS,
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : raw.uiMode !== 'original',
    mode: raw.mode === 'essentials' ? 'essentials' as const : 'full' as const,
    accountPreference: normalizeAccountPreference(raw.accountPreference),
  };
  for (const feature of FEATURE_DEFINITIONS) {
    const legacyKey = 'legacyKey' in feature ? feature.legacyKey : feature.key;
    const value = raw[feature.key] ?? raw[legacyKey];
    settings[feature.key] = typeof value === 'boolean' ? value : feature.defaultValue;
  }
  return settings;
}

export async function getSettings(): Promise<Settings> {
  const storage = extensionApi().storage.sync;
  // Normalize legacy preferences on read. A full migration write could race
  // with a newer choice saved by another tab or the popup.
  return normalizeSettings(await storage.get(null));
}

export function settingsPatch(update: Partial<Omit<Settings, 'schemaVersion'>>): Record<string, unknown> {
  // Store a patch so updates from two tabs cannot overwrite each other's switches.
  const validated: Record<string, unknown> = { schemaVersion: 2 };
  if (typeof update.enabled === 'boolean') validated.enabled = update.enabled;
  if (update.mode !== undefined) {
    if (update.mode !== 'essentials' && update.mode !== 'full') throw new Error('Choose a valid enhancement mode.');
    validated.mode = update.mode;
  }
  if (update.accountPreference !== undefined) {
    const preference = normalizeAccountPreference(update.accountPreference);
    if (update.accountPreference.trim() && !preference) throw new Error('Enter a valid email address or school account domain.');
    validated.accountPreference = preference;
  }
  for (const { key } of FEATURE_DEFINITIONS) {
    if (typeof update[key] === 'boolean') validated[key] = update[key];
  }
  return validated;
}

export async function updateSettings(update: Partial<Omit<Settings, 'schemaVersion'>>): Promise<void> {
  // Validate before dispatch, then hand persistence to the worker immediately.
  settingsPatch(update);
  await requestCoordinator({ channel: 'blackbaud-next-coordinator-v1', kind: 'settings', update });
}

export function subscribeSettings(callback: () => void): Cleanup {
  const event = extensionApi().storage.onChanged;
  const listener = (_changes: unknown, area: string) => { if (area === 'sync') callback(); };
  event.addListener(listener);
  return () => event.removeListener(listener);
}
