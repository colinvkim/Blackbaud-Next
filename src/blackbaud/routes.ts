export function isSchoolPage(url: URL): boolean {
  return url.protocol === 'https:' && url.hostname.endsWith('.myschoolapp.com');
}

export function isLoginPage(url: URL): boolean {
  return isSchoolPage(url) && (
    /(?:^|\/)login(?:\.|\/|$)/i.test(url.pathname) || /^#login(?:\/|\?|$)/i.test(url.hash)
  );
}

export function isLmsPage(url: URL): boolean {
  return isSchoolPage(url) && !isLoginPage(url);
}

export function isBlackbaudSignin(url: URL): boolean {
  return url.origin === 'https://app.blackbaud.com' && /^\/signin(?:\/|$)/.test(url.pathname);
}

export function isGoogleOAuth(url: URL): boolean {
  if (url.origin !== 'https://accounts.google.com') return false;
  let current = url;
  // Google can carry the OAuth request inside its own continuation URL.
  for (let depth = 0; depth < 3; depth += 1) {
    const redirect = current.searchParams.get('redirect_uri');
    if (redirect) {
      try {
        const callback = new URL(redirect);
        return callback.origin === 'https://id.blackbaud.com';
      } catch { return false; }
    }
    const continuation = current.searchParams.get('continue');
    if (!continuation) return false;
    try {
      current = new URL(continuation);
      if (current.origin !== 'https://accounts.google.com') return false;
    } catch { return false; }
  }
  return false;
}

export function studentDashboardUrl(hostname: string): string {
  if (!/^[a-z0-9-]+\.myschoolapp\.com$/i.test(hostname)) throw new Error('Invalid school hostname.');
  return `https://${hostname}/app/student?svcid=edu`;
}

export function blackbaudSigninUrl(hostname: string): string {
  return `https://app.blackbaud.com/signin/?redirectUrl=${encodeURIComponent(studentDashboardUrl(hostname))}`;
}

export function legacyAssignmentCenterUrl(url: URL): string {
  return `${studentDashboardUrl(url.hostname)}#studentmyday/assignment-center`;
}

export function isAssignmentCenter(url: URL): boolean {
  return isLmsPage(url) && url.pathname.includes('/lms-assignment/assignment-center');
}
