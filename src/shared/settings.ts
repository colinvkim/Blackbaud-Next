import { extensionApi } from './extension.ts';
import { requestCoordinator } from './coordinator.ts';
import type { Cleanup } from './types.ts';

export const FEATURE_DEFINITIONS = [
  { key: 'pageAppearance', label: 'Page appearance', description: 'Readable layouts, clearer controls, and comfortable spacing.', group: 'appearance', defaultValue: true },
  { key: 'helpfulTabTitles', label: 'Useful tab titles', description: 'Identify the course, assignment, or page in each browser tab.', group: 'appearance', defaultValue: true },
  { key: 'assignmentShortcuts', label: 'Assignment shortcuts', description: 'Quickly focus on unfinished work or assignments due today and tomorrow.', group: 'assignments', defaultValue: true },
  { key: 'assignmentPreviews', label: 'Assignment previews', description: 'Read instructions and open attachments beside the assignment list.', group: 'assignments', defaultValue: true },
  { key: 'prepareAssignmentCenter', label: 'Faster Assignment Center', description: 'Prepare Assignment Center on Schedule or when you hover over or focus its link.', group: 'assignments', defaultValue: true },
  { key: 'optimizeLoginPage', legacyKey: 'loginFix', label: 'Simpler sign-in', description: 'Add a direct Google sign-in option on the school login page.', group: 'login', defaultValue: true },
  { key: 'automaticLogin', label: 'Automatic login', description: 'Continue through Blackbaud and select your school Google account.', group: 'login', defaultValue: true },
  { key: 'loadingOverlay', legacyKey: 'loadBetweenPages', label: 'Sign-in progress', description: 'Show a dismissible status while automatic login runs.', group: 'login', defaultValue: true },
  { key: 'fixFavicon', label: 'Tab icon', description: 'Give Blackbaud tabs a recognizable icon.', group: 'tools', defaultValue: true },
  { key: 'rosterTools', legacyKey: 'copyRosterTools', label: 'Roster tools', description: 'Copy roster names or email addresses in one click.', group: 'tools', defaultValue: true },
  { key: 'classSwitching', label: 'Better class switching', description: 'Search classes and keep Assignments or Roster open when switching.', group: 'tools', defaultValue: true },
  { key: 'resourceSearch', label: 'Resource Board search', description: 'Find resource cards by name or description.', group: 'tools', defaultValue: true },
  { key: 'downloadFullAvatar', label: 'Full-size profile photos', description: 'Open the original photo from a directory profile.', group: 'tools', defaultValue: true },
  { key: 'enhancedDirectory', label: 'Better directories', description: 'Search and browse any directory with compact results and local sorting.', group: 'tools', defaultValue: true },
  { key: 'oldAssignmentCenter', label: 'Legacy assignment center', description: 'Use the older assignment center when available.', group: 'compatibility', defaultValue: false },
  { key: 'fixInvalidPages', legacyKey: 'fixBrokenAssignmentCenter', label: 'Assignment loading recovery', description: 'Offer recovery when the assignment center stays stuck.', group: 'compatibility', defaultValue: true },
] as const;

export type FeatureKey = typeof FEATURE_DEFINITIONS[number]['key'];
export type Settings = { schemaVersion: 2; enabled: boolean; accountPreference: string } & Record<FeatureKey, boolean>;

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: 2,
  enabled: true,
  accountPreference: '',
  ...Object.fromEntries(FEATURE_DEFINITIONS.map((feature) => [feature.key, feature.defaultValue])),
} as Settings;

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
