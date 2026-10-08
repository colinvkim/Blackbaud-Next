import type { Settings } from './settings.ts';

export type Cleanup = () => void;

export interface FeatureContext {
  url: URL;
  settings: Settings;
  signal: AbortSignal;
}

export interface Feature {
  id: string;
  enabled: (settings: Settings) => boolean;
  matches: (url: URL) => boolean;
  // Declare settings read by mount or its callbacks. enabled is reevaluated
  // separately. Omitting this list conservatively depends on every setting.
  settingsKeys?: readonly (keyof Settings)[];
  // Page scope remounts on each URL change. Document scope is for features
  // that do not capture route-specific state and remain compatible on matches.
  routeScope?: 'page' | 'document';
  mount: (context: FeatureContext) => Cleanup | void;
}
