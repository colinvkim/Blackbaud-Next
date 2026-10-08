import { fullSizePhotoUrl, profilePhotoForOptions } from '../blackbaud/avatar.ts';
import { isLmsPage } from '../blackbaud/routes.ts';
import { createButton, observeDom } from '../shared/dom.ts';
import type { Cleanup, Feature } from '../shared/types.ts';

export const avatarDownloadFeature: Feature = {
  id: 'profile-photo',
  enabled: (settings) => settings.downloadFullAvatar,
  matches: (url) => isLmsPage(url) && /^#directory\/\d+(?:\/|\?|$)/i.test(url.hash),
  mount: ({ signal }) => {
    const mounted = new Map<Element, { button: HTMLButtonElement; cleanup: Cleanup }>();
    const stop = observeDom(() => {
      for (const [options, control] of mounted) {
        if (!options.isConnected || !profilePhotoForOptions(options)) {
          control.cleanup();
          mounted.delete(options);
        }
      }
      for (const options of document.querySelectorAll('.user-options-button')) {
        if (mounted.has(options) || !profilePhotoForOptions(options)) continue;
        const button = createButton('Open full-size photo');
        button.dataset.blackbaudNextPhoto = '1';
        const open = () => {
          if (signal.aborted) return;
          const image = profilePhotoForOptions(options);
          const url = image ? fullSizePhotoUrl(image.src, window.location.href) : null;
          if (url) window.open(url, '_blank', 'noopener,noreferrer');
        };
        button.addEventListener('click', open);
        const anchor = options.closest('.btn-group, .dropdown, .user-options') ?? options;
        anchor.insertAdjacentElement('afterend', button);
        mounted.set(options, { button, cleanup: () => { button.removeEventListener('click', open); button.remove(); } });
      }
    }, signal);
    return () => {
      stop();
      for (const control of mounted.values()) control.cleanup();
      mounted.clear();
    };
  },
};
