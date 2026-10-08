import { isSchoolPage } from '../blackbaud/routes.ts';
import { extensionApi } from '../shared/extension.ts';
import type { Feature } from '../shared/types.ts';

export const faviconFeature: Feature = {
  id: 'favicon',
  enabled: (settings) => settings.fixFavicon,
  matches: isSchoolPage,
  mount: () => {
    const link = document.createElement('link');
    link.dataset.blackbaudNextFavicon = '1';
    link.rel = 'icon';
    link.type = 'image/png';
    link.href = extensionApi().runtime.getURL('assets/blackbaud.png');
    (document.head ?? document.documentElement).append(link);
    return () => link.remove();
  },
};
