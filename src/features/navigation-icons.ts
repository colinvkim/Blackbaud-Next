import type { NativeNavigationIconTarget } from '../blackbaud/appearance-icons.ts';
import { createAttributeOwnership } from '../shared/attribute-ownership.ts';
import { createIcon } from '../shared/icons.ts';
import type { IconName } from '../shared/icons.ts';

interface MountedIcon {
  kind: IconName;
  original: Element | null;
  icon: SVGSVGElement;
}

export function createNavigationIcons() {
  const mounted = new Map<HTMLAnchorElement, MountedIcon>();
  const originals = createAttributeOwnership<Element>();
  const restore = (control: HTMLAnchorElement) => {
    const entry = mounted.get(control);
    if (!entry) return;
    entry.icon.remove();
    if (entry.original) originals.restore(entry.original, 'data-bn-native-icon');
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
        entry = { kind, original, icon };
        mounted.set(control, entry);
      }
      if (original) originals.mark(original, 'data-bn-native-icon', 'replaced');
      // Native renders can replace children while retaining their anchor.
      if (entry.icon.parentElement !== control) control.prepend(entry.icon);
    }
  };
  return { update, clear };
}
