import {
  ArrowLeft, BookOpen, BookUser, Calendar, CalendarDays, ChartColumn, ChartNoAxesColumnIncreasing, Check,
  ChevronDown, ChevronLeft, ChevronRight, ClipboardCheck, ClipboardList, Clock3, ContactRound, Copy,
  ExternalLink, Eye, FileText, Folder, FolderOpen, GraduationCap, House, ListFilter, LogIn, Mail, Newspaper,
  Palette, RefreshCw, Search, Settings, Users, UsersRound, Wrench, X,
} from 'lucide';

// Explicit imports keep the shipped set small. Render into the caller's
// document so detached fixtures and the popup do not need a global DOM.
const icons = {
  'arrow-left': ArrowLeft, 'book-open': BookOpen, 'book-user': BookUser, calendar: CalendarDays,
  'calendar-outline': Calendar,
  chart: ChartNoAxesColumnIncreasing, 'chart-column': ChartColumn, check: Check, 'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft, 'chevron-right': ChevronRight,
  'clipboard-check': ClipboardCheck, 'clipboard-list': ClipboardList, 'clock-3': Clock3, contact: ContactRound, copy: Copy,
  'external-link': ExternalLink, eye: Eye, 'file-text': FileText, folder: FolderOpen, 'folder-closed': Folder,
  'graduation-cap': GraduationCap, house: House, 'list-filter': ListFilter, 'log-in': LogIn,
  mail: Mail, newspaper: Newspaper, palette: Palette, refresh: RefreshCw, search: Search,
  settings: Settings, users: Users, 'users-round': UsersRound, wrench: Wrench, x: X,
};

export type IconName = keyof typeof icons;

export function createIcon(name: IconName, page: Document = document): SVGSVGElement {
  const namespace = 'http://www.w3.org/2000/svg';
  const icon = page.createElementNS(namespace, 'svg');
  const attributes = {
    xmlns: namespace, width: '18', height: '18', viewBox: '0 0 24 24',
    fill: 'none', stroke: 'currentColor', 'stroke-width': '2',
    'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    class: 'bn-icon', 'aria-hidden': 'true', focusable: 'false', 'data-bn-owned': '',
  };
  for (const [key, value] of Object.entries(attributes)) icon.setAttribute(key, value);
  for (const [tag, values] of icons[name]) {
    const shape = page.createElementNS(namespace, tag);
    for (const [key, value] of Object.entries(values)) {
      if (value !== undefined) shape.setAttribute(key, String(value));
    }
    icon.append(shape);
  }
  return icon;
}
