import { DIRECTORY_ROOT_SELECTOR, PROFILE_CARD_ATTRIBUTES, PROFILE_CARD_SELECTOR, fullSizePhotoUrl, profileCardForOptions, profileOptionsInCard, profilePhotoForOptions, profileToolAnchor } from '../blackbaud/avatar.ts';
import { isLmsPage } from '../blackbaud/routes.ts';
import { createButton, observeDom, watchAddedElements } from '../shared/dom.ts';
import type { Cleanup, Feature } from '../shared/types.ts';

export const avatarDownloadFeature: Feature = {
  id: 'profile-photo',
  settingsKeys: [],
  enabled: (settings) => settings.downloadFullAvatar,
  matches: (url) => isLmsPage(url) && /^#directory\/\d+(?:\/|\?|$)/i.test(url.hash),
  mount: ({ signal }) => watchAddedElements(DIRECTORY_ROOT_SELECTOR, (root) =>
    watchAddedElements(PROFILE_CARD_SELECTOR, (card) => {
      const mounted = new Map<Element, { button: HTMLButtonElement; cleanup: Cleanup }>();
      const stop = observeDom(() => {
        for (const [options, control] of mounted) {
          if (profileCardForOptions(options) !== card || !control.button.isConnected || !profilePhotoForOptions(options)) {
            control.cleanup();
            mounted.delete(options);
          }
        }
        for (const options of profileOptionsInCard(card)) {
          if (mounted.has(options) || !profilePhotoForOptions(options)) continue;
          const button = createButton('Open full-size photo');
          button.dataset.blackbaudNextPhoto = '1';
          const open = () => {
            if (signal.aborted || !card.isConnected || profileCardForOptions(options) !== card) return;
            const image = profilePhotoForOptions(options);
            const url = image ? fullSizePhotoUrl(image.src, window.location.href) : null;
            if (url) window.open(url, '_blank', 'noopener,noreferrer');
          };
          button.addEventListener('click', open);
          profileToolAnchor(options).insertAdjacentElement('afterend', button);
          mounted.set(options, { button, cleanup: () => { button.removeEventListener('click', open); button.remove(); } });
        }
      }, signal, card);
      return () => {
        stop();
        for (const control of mounted.values()) control.cleanup();
        mounted.clear();
      };
    }, signal, root, PROFILE_CARD_ATTRIBUTES), signal, document, ['id']),
};
