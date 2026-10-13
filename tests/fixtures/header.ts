export const HEADER_PRIMARY_ITEMS = [
  ['group-header-Classes', 'Classes', 'classes_48.png', '#', 'book-open'],
  ['group-header-Groups', 'Groups', 'groups.png', '/app/SignOut', 'users-round'],
  ['group-header-Resources', 'Resources', 'resources.png', '/app/student?svcid=edu#resourceboard', 'folder-closed'],
  ['group-header-News', 'News', 'news.png', '#', 'newspaper'],
  ['calendar-subnav', 'Calendar', 'calendar.png', '/app/student?svcid=edu#calendar', 'calendar-outline'],
  ['directory-subnav', 'Directories', 'directory.png', '#', 'book-user'],
] as const;

export const HEADER_LOWER_ITEMS = [
  ['progress-btn', 'Progress', 'p3icon-progress', '/app/student?svcid=edu#studentmyday/progress', 'chart-column'],
  ['schedule-btn', 'Schedule', 'p3icon-schedule', '/app/student?svcid=edu#studentmyday/schedule', 'clock-3'],
  ['assignment-center-btn', 'Assignment Center', 'p3icon-assignments', '/lms-assignment/assignment-center/student/?svcid=edu', 'clipboard-check'],
  ['course-requests-btn', 'Course Requests', 'p3icon-courseRequest', '/edu-self-registration/student-course-requests?svcid=edu', 'graduation-cap'],
] as const;

const counts: Record<string, string> = { Classes: '14', Groups: '4', Directories: '5' };

export function nativeHeaderDescription(modern: boolean, label: string, count = ''): string {
  return modern
    ? `<div class="desc"><div class="title"><div>${label}</div><!----></div>${count ? `<strong>${count}</strong> ${label} <!---->` : ''}</div>`
    : `<span class="desc"><span class="title">${label}</span>${count ? `<br><b>${count}</b> ${label}` : ''}</span>`;
}

export function nativePrimaryDescription(modern: boolean, label: string, includeCounts = true): string {
  return nativeHeaderDescription(modern, label, includeCounts ? counts[label] : '');
}

interface PrimaryOptions {
  counts?: boolean;
  myDayId?: string;
  dayBadge?: 'date' | 'day';
  relativeLegacyLinks?: boolean;
}

export function nativePrimaryNavigation(modern = false, options: PrimaryOptions = {}): string {
  const description = (label: string) => nativePrimaryDescription(modern, label, options.counts !== false);
  const day = options.dayBadge === 'day' ? '<span class="dayicon">9</span>' : '<div class="dayicon"><span class="month">Oct</span><span class="day">9</span></div>';
  return `<nav id="site-nav-container"><ul class="topnav"><li><a id="${options.myDayId ?? 'my-day'}" class="${modern ? 'root-nav-item' : ''}" href="/app/student?svcid=edu#studentmyday">${day}${description('My Day')}</a></li>
    ${HEADER_PRIMARY_ITEMS.map(([id, label, file, href]) => {
      const destination = modern && id === 'group-header-Groups' ? '#' : !modern && options.relativeLegacyLinks ? href.replace('/app/student', '') : href;
      return `<li><a id="${id}" class="${modern ? 'root-nav-item' : ''}" href="${destination}"><img src="//libs-w2.myschoolapp.com/p3-cache/img/48x48/${file}">${description(label)}${modern ? '<sky-icon iconname="caret-down"></sky-icon>' : '<span class="caret"></span>'}</a></li>`;
    }).join('')}</ul></nav>`;
}

export function nativeLowerNavigation(modern = false, label = 'Native page'): string {
  return `<nav id="site-nav-lower"><ul>${HEADER_LOWER_ITEMS.map(([id, , icon, href]) => `<li><a ${modern ? '' : `id="${id}"`} href="${href}"><i class="${icon}"></i>${label}</a></li>`).join('')}</ul></nav>`;
}

export function nativeUtilityHeader(modern = false): string {
  const description = (label: string) => nativeHeaderDescription(modern, label);
  const tools = `<ul class="topnav${modern ? ' user-nav' : ''}">
    <li><a ${modern ? 'class="root-nav-item search-item"' : ''} href="/app/student?svcid=edu#searchresults">${modern ? '<span class="search"><sky-icon iconname="search"></sky-icon></span><span class="expand"><sky-icon iconname="caret-down"></sky-icon></span>' : '<i class="topnav-icon p3icon-search"></i><span class="caret for-search"></span>'}</a></li>
    <li><a ${modern ? 'id="official-notes"' : ''} href="/app/student?svcid=edu#message/officialnotes"><span class="site-badge ${modern ? 'site-badge-message' : 'site-badge-official-notes'}">2</span>&nbsp;${description('Official Notes')}</a></li>
    <li><a id="inbox-link" href="/app/student?svcid=edu#message/inbox"><span class="site-badge site-badge-message">0</span>&nbsp;${description('Messages')}</a></li>
    <li><a id="account-nav" href="#"><div class="bb-avatar-wrapper-nav"><img class="bb-avatar-image-nav" src="/fixture-avatar.svg" alt="Example account avatar"></div>${modern ? '<div class="desc"><div class="title"><div>Alex</div><div>Student</div></div></div><span class="expand"><sky-icon iconname="caret-down"></sky-icon></span>' : '<span class="desc"><span class="title">Alex<br>Student</span></span><span class="caret"></span>'}</a></li>
  </ul>`;
  return `<header id="site-header" class="${modern ? 'sky-container' : 'container'}"><div class="row"><div class="col-md-12">
    <button id="site-mobile-btn" class="app-mobile-menu-btn" type="button">Native menu</button>
    <div id="site-logo" class="logoimg"><a href="http://school.example"><img src="/fixture-school-logo.svg" alt="Example School"></a></div>
    ${modern ? `<div id="site-user-container"><div id="site-user-nav"><edu-user-nav>${tools}</edu-user-nav></div></div>` : `<div id="site-user-container" hidden>Native persona switcher</div><nav id="site-user-nav" class="site-header-nav"><div>${tools}</div></nav>`}
  </div></div></header>`;
}

export function nativeHeaderFixtureHtml(modern = false): string {
  const content = nativeUtilityHeader(modern) + nativePrimaryNavigation(modern) + nativeLowerNavigation(modern) + '<main id="site-main"></main>';
  return (modern ? `<app-root>${content}</app-root>` : content) + `<div id="site-top-spacer" class="${modern ? 'white-bg site-top-spacer-lower-nav' : 'site-top-spacer'}"></div>`;
}
