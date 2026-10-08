import type { Feature, FeatureContext, Cleanup } from '../shared/types.ts';
import type { Settings } from '../shared/settings.ts';

export class FeatureController {
  private active = new Map<string, { abort: AbortController; cleanup: Cleanup }>();
  private signature = '';
  private features: Feature[];
  private reportError: (id: string, error: unknown) => void;

  constructor(features: Feature[], reportError = (id: string, error: unknown) => {
    console.warn(`Blackbaud Next: ${id} could not start.`, error);
  }) {
    this.features = features;
    this.reportError = reportError;
  }

  update(url: URL, settings: Settings): void {
    const signature = JSON.stringify([url.href, settings]);
    if (this.signature === signature) return;
    this.dispose();
    this.signature = signature;
    if (!settings.enabled) return;
    for (const feature of this.features) {
      const abort = new AbortController();
      const context: FeatureContext = { url, settings, signal: abort.signal };
      try {
        if (!feature.enabled(settings) || !feature.matches(url)) continue;
        const cleanup = feature.mount(context) ?? (() => {});
        this.active.set(feature.id, { abort, cleanup });
      } catch (error) {
        abort.abort();
        this.reportError(feature.id, error);
      }
    }
  }

  dispose(): void {
    for (const [id, feature] of this.active) {
      feature.abort.abort();
      try { feature.cleanup(); } catch (error) { this.reportError(id, error); }
    }
    this.active.clear();
    this.signature = '';
  }
}
