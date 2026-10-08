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
    const optionCount = scope.querySelectorAll('.user-options-button').length;
    if (optionCount > 1) return null;
    const images = [...scope.querySelectorAll<HTMLImageElement>("img[src*='/user/large_user_']")];
    if (images.length > 1) return null;
    const isProfileCard = scope.matches('[data-user-id], [data-userid], [data-person-id], .user-card, .directory-card, .profile-card, .user-info, .list-group-item, article, li, tr');
    if (isProfileCard) return optionCount === 1 && images.length === 1 ? images[0] ?? null : null;
    scope = scope.parentElement;
  }
  return null;
}
