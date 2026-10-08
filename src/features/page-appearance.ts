import { isSchoolPage } from '../blackbaud/routes.ts';
import { addStyle } from '../shared/dom.ts';
import type { Feature } from '../shared/types.ts';

const TOOL_STYLES = `
.bn-tools { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin: 10px 0; font: 14px/1.45 system-ui, -apple-system, sans-serif; }
.bn-button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 34px; padding: 6px 12px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; color: #244366; font: 500 14px/1.4 system-ui, -apple-system, sans-serif; text-decoration: none; cursor: pointer; }
.bn-button:hover:not(:disabled) { background: #eef4fb; border-color: #8da7c5; color: #163963; }
.bn-button:focus-visible { outline: 3px solid #316bb6; outline-offset: 3px; }
.bn-button:disabled { cursor: wait; opacity: .65; }
.bn-tool-status { color: #526174; font: 13px/1.5 system-ui, -apple-system, sans-serif; }
.bn-recovery { color: #22354e; background: #fff; border: 1px solid #d1dbe7; border-radius: 10px; padding: 16px; box-shadow: 0 8px 32px #18314e24; font: 14px/1.5 system-ui, -apple-system, sans-serif; }
.bn-recovery p { margin: 0 0 12px; }
`;

// Styles deliberately target native legacy components. SKY controls retain
// their own layout, sizing and behavior; no application shell is hidden.
const PAGE_STYLES = `
html[data-blackbaud-next-appearance] #site-main { width: calc(100% - 48px); max-width: 1240px; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.5; }
html[data-blackbaud-next-appearance] #site-main :is(h1, h2, h3, h4, h5) { font-family: inherit; line-height: 1.35; }
html[data-blackbaud-next-appearance] #coursesContainer > .row { display: grid; grid-template-columns: minmax(190px, 1.6fr) minmax(65px, .5fr) minmax(145px, 1fr) minmax(65px, .5fr) minmax(155px, 1.1fr); gap: 16px; margin: 0; padding: 20px 18px; border-bottom: 1px solid #e1e7ef; }
html[data-blackbaud-next-appearance] #coursesContainer > .row::before,
html[data-blackbaud-next-appearance] #coursesContainer > .row::after { display: none; }
html[data-blackbaud-next-appearance] #coursesContainer > .row > :is(.col-md-2, .col-md-3) { float: none; width: auto; min-width: 0; padding: 0; }
html[data-blackbaud-next-appearance] #coursesContainer > .row > .col-md-3:first-child a { font-size: 16px; font-weight: 600; line-height: 1.4; }
html[data-blackbaud-next-appearance] #coursesContainer h5 { font-size: 12px; line-height: 1.5; }
html[data-blackbaud-next-appearance] #site-main .table { font-size: 14px; }
html[data-blackbaud-next-appearance] #site-main .table > thead > tr > th { background: #f5f7fa; color: #31425a; font-weight: 600; padding: 11px 12px; border-bottom-color: #d4dce6; }
html[data-blackbaud-next-appearance] #site-main .table > tbody > tr > td { padding: 11px 12px; vertical-align: middle; border-top-color: #e4e9ef; }
html[data-blackbaud-next-appearance] #site-main .table-striped > tbody > tr:nth-of-type(odd) { background: #f8fafc; }
html[data-blackbaud-next-appearance] #site-main .btn { border-radius: 6px; }
html[data-blackbaud-next-appearance] #site-main .nav-tabs > li > a { padding: 10px 16px; }
html[data-blackbaud-next-appearance] #site-main :is(a, button, input, select, textarea):focus-visible { outline: 3px solid #316bb6; outline-offset: 2px; }
html[data-blackbaud-next-appearance] .site-login-box { max-width: calc(100vw - 32px); border-radius: 10px; overflow: hidden; box-shadow: 0 8px 32px #18263f14; }
html[data-blackbaud-next-appearance] .site-login-input input[type="text"], html[data-blackbaud-next-appearance] .site-login-input input[type="email"] { border-radius: 6px; padding: 10px 12px; }
@media (max-width: 850px) {
  html[data-blackbaud-next-appearance] #coursesContainer > .row { display: flex; flex-wrap: wrap; gap: 16px 24px; padding: 16px 12px; }
  html[data-blackbaud-next-appearance] #coursesContainer > .row > .col-md-3:first-child { flex-basis: 100%; }
}
@media (max-width: 700px) {
  html[data-blackbaud-next-appearance] #site-main { width: calc(100% - 24px); }
  html[data-blackbaud-next-appearance] #site-main .table > tbody > tr > td,
  html[data-blackbaud-next-appearance] #site-main .table > thead > tr > th { padding: 8px; }
  html[data-blackbaud-next-appearance] .site-login-box { margin-left: auto; margin-right: auto; }
}
`;

export const toolStylesFeature: Feature = {
  id: 'tool-styles',
  enabled: () => true,
  matches: isSchoolPage,
  mount: () => addStyle('tools', TOOL_STYLES),
};

export const pageAppearanceFeature: Feature = {
  id: 'page-appearance',
  enabled: (settings) => settings.pageAppearance,
  matches: isSchoolPage,
  mount: () => {
    const root = document.documentElement;
    const previous = root.getAttribute('data-blackbaud-next-appearance');
    root.setAttribute('data-blackbaud-next-appearance', 'true');
    const removeStyle = addStyle('appearance', PAGE_STYLES);
    return () => {
      removeStyle();
      if (previous === null) root.removeAttribute('data-blackbaud-next-appearance');
      else root.setAttribute('data-blackbaud-next-appearance', previous);
    };
  },
};
