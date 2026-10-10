import { mountPopup } from '../popup/controller.ts';
import { createIcon, type IconName } from '../shared/icons.ts';
import '../popup/styles.css';

const headingIcons: readonly (readonly [string, IconName])[] = [
  ['appearance-heading', 'palette'],
  ['assignments-heading', 'clipboard-list'],
  ['login-heading', 'log-in'],
  ['tools-heading', 'wrench'],
  ['compatibility-heading', 'settings'],
];
for (const [id, icon] of headingIcons) document.getElementById(id)?.prepend(createIcon(icon, document));
document.getElementById('compatibility-chevron')?.append(createIcon('chevron-down', document));

mountPopup(document, window);
