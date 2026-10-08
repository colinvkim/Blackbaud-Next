import type { Feature, FeatureContext, Cleanup } from '../shared/types.ts';
import type { Settings } from '../shared/settings.ts';

interface MountedFeature {
  abort: AbortController;
  cleanup: Cleanup;
  signature: string;
}

function mountSignature(feature: Feature, url: URL, settings: Settings): string {
  const keys = feature.settingsKeys ?? (Object.keys(settings) as Array<keyof Settings>).sort();
  return JSON.stringify([
    url.origin,
    feature.routeScope === 'document' ? null : url.href,
    keys.map((key) => [key, settings[key]]),
  ]);
}

export class FeatureController {
  private active = new Map<string, MountedFeature>();
  private features: Feature[];
  private reportError: (id: string, error: unknown) => void;

  constructor(features: Feature[], reportError = (id: string, error: unknown) => {
    console.warn(`Blackbaud Next: ${id} could not start.`, error);
  }) {
    this.features = features;
    this.reportError = reportError;
  }

  update(url: URL, settings: Settings): void {
    const desired = new Map<string, { feature: Feature; signature: string }>();
    if (settings.enabled) {
      for (const feature of this.features) {
        try {
          if (feature.enabled(settings) && feature.matches(url)) {
            desired.set(feature.id, { feature, signature: mountSignature(feature, url, settings) });
          }
        } catch (error) {
          // An applicability/dependency error also invalidates this feature's
          // previous work. Other mounted features remain independently usable.
          this.reportError(feature.id, error);
        }
      }
    }
    // Restore native state before mounting replacements that may use it.
    for (const [id, mounted] of this.active) {
      if (desired.get(id)?.signature !== mounted.signature) this.unmount(id, mounted);
    }
    for (const [id, { feature, signature }] of desired) {
      if (this.active.has(id)) continue;
      const abort = new AbortController();
      const context: FeatureContext = { url, settings, signal: abort.signal };
      try {
        const cleanup = feature.mount(context) ?? (() => {});
        this.active.set(id, { abort, cleanup, signature });
      } catch (error) {
        abort.abort();
        this.reportError(id, error);
      }
    }
  }

  private unmount(id: string, mounted: MountedFeature): void {
    this.active.delete(id);
    mounted.abort.abort();
    try { mounted.cleanup(); } catch (error) { this.reportError(id, error); }
  }

  dispose(): void {
    for (const [id, mounted] of this.active) this.unmount(id, mounted);
  }
}
