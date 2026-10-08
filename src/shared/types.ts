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
  mount: (context: FeatureContext) => Cleanup | void;
}
