export const DIRECTORY_ROOT_SELECTOR = '#directory-results';
export const PROFILE_CARD_SELECTOR = '[data-user-id], [data-userid], [data-person-id], .user-card, .directory-card, .profile-card, .user-info, .list-group-item, article, li, tr';
export const PROFILE_OPTIONS_SELECTOR = '.user-options-button';
export const PROFILE_CARD_ATTRIBUTES = ['class', 'data-user-id', 'data-userid', 'data-person-id'];

export function profileCardForOptions(options: Element): Element | null {
  return options.parentElement?.closest(PROFILE_CARD_SELECTOR) ?? null;
}

export function profileOptionsInCard(card: Element): Element[] {
  return [...card.querySelectorAll(PROFILE_OPTIONS_SELECTOR)].filter((options) => profileCardForOptions(options) === card);
}

export function profileToolAnchor(options: Element): Element {
  return options.closest('.btn-group, .dropdown, .user-options') ?? options;
}

export function fullSizePhotoUrl(imageUrl: string, baseUrl: string): string | null {
  try {
    const url = new URL(imageUrl, baseUrl);
    if (url.protocol !== 'https:' || !/\/user\/large_user_/i.test(url.pathname)) return null;
    url.searchParams.delete('resize');
    return url.href;
  } catch {
    return null;
  }
}

// Refuse a guess when a directory container contains multiple people's images.
export function profilePhotoForOptions(options: Element): HTMLImageElement | null {
  let scope = options.parentElement;
  while (scope && scope !== document.body && scope !== document.documentElement) {
    const optionCount = scope.querySelectorAll(PROFILE_OPTIONS_SELECTOR).length;
    if (optionCount > 1) return null;
    const images = [...scope.querySelectorAll<HTMLImageElement>("img[src*='/user/large_user_']")];
    if (images.length > 1) return null;
    const isProfileCard = scope.matches(PROFILE_CARD_SELECTOR);
    if (isProfileCard) return optionCount === 1 && images.length === 1 ? images[0] ?? null : null;
    scope = scope.parentElement;
  }
  return null;
}
