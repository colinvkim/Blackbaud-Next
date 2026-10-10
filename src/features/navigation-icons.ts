import type { NativeNavigationIconTarget } from '../blackbaud/appearance-icons.ts';
import { createIcon } from '../shared/icons.ts';
import type { IconName } from '../shared/icons.ts';

interface MountedIcon {
  kind: IconName;
  original: Element | null;
  previous: string | null;
  icon: SVGSVGElement;
}

export function createNavigationIcons() {
  const mounted = new Map<HTMLAnchorElement, MountedIcon>();
  const restore = (control: HTMLAnchorElement) => {
    const entry = mounted.get(control);
    if (!entry) return;
    entry.icon.remove();
    if (entry.original) {
      if (entry.previous === null) entry.original.removeAttribute('data-bn-native-icon');
      else entry.original.setAttribute('data-bn-native-icon', entry.previous);
    }
    mounted.delete(control);
  };
  const clear = () => { for (const control of mounted.keys()) restore(control); };
  const update = (targets: NativeNavigationIconTarget[]) => {
    const active = new Set(targets.map(({ control }) => control));
    for (const control of mounted.keys()) if (!active.has(control)) restore(control);
    for (const { control, kind, original } of targets) {
      let entry = mounted.get(control);
      if (entry && (entry.kind !== kind || entry.original !== original)) {
        restore(control);
        entry = undefined;
      }
      if (!entry) {
        const icon = createIcon(kind, control.ownerDocument);
        icon.setAttribute('data-bn-navigation-icon', kind);
        entry = { kind, original, previous: original?.getAttribute('data-bn-native-icon') ?? null, icon };
        mounted.set(control, entry);
      }
      if (original?.getAttribute('data-bn-native-icon') !== 'replaced') original?.setAttribute('data-bn-native-icon', 'replaced');
      // Native renders can replace children while retaining their anchor.
      if (entry.icon.parentElement !== control) control.prepend(entry.icon);
    }
  };
  return { update, clear };
}
