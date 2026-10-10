import { appearanceLayoutFeature } from '../features/appearance-layout.ts';
import { pageAppearanceFeature, toolStylesFeature } from '../features/page-appearance.ts';
import type { Cleanup } from '../shared/types.ts';
import { startExtension } from './start.ts';

function waitForDocumentRoot(signal: AbortSignal): Promise<void> {
  const page = document;
  if (page.documentElement || signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => { if (page.documentElement) finish(); });
    const finish = () => {
      observer.disconnect();
      signal.removeEventListener('abort', finish);
      resolve();
    };
    observer.observe(page, { childList: true });
    signal.addEventListener('abort', finish, { once: true });
    if (page.documentElement || signal.aborted) finish();
  });
}

export function startAppearance(): Promise<Cleanup> {
  return startExtension([toolStylesFeature, pageAppearanceFeature, appearanceLayoutFeature], {
    ready: waitForDocumentRoot,
  });
}
