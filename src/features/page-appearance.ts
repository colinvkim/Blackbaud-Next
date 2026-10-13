import { isSchoolPage } from '../blackbaud/routes.ts';
import { addStyle } from '../shared/dom.ts';
import type { Feature } from '../shared/types.ts';
import { PROGRESS_STYLES } from './progress-styles.ts';

const TOOL_STYLES = `
html {
  --bn-font: "Blackbaud Sans", "Helvetica Neue", Arial, sans-serif;
  --bn-text: #222a35; --bn-muted: #657080;
  --bn-accent: #0066a1; --bn-accent-hover: #004d7a; --bn-accent-soft: #eef6fa;
  --bn-surface: #fff; --bn-page: #f5f6f8;
  --bn-border: #dde3e8; --bn-border-strong: #bbc7d1;
  --bn-radius: 8px; --bn-radius-lg: 12px;
  --bn-shadow: 0 2px 8px #222a3508;
}
.bn-tools { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin: 12px 0; color: var(--bn-text); font: 14px/1.5 var(--bn-font); }
.bn-icon { display: inline-block; flex: none; width: 18px; height: 18px; vertical-align: middle; pointer-events: none; }
.bn-icon-label { display: inline-flex; align-items: center; gap: 7px; }
.bn-button { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 36px; padding: 7px 12px; border: 1px solid var(--bn-border-strong); border-radius: var(--bn-radius); background: var(--bn-surface); color: var(--bn-text); font: 600 14px/1.4 var(--bn-font); text-decoration: none; cursor: pointer; box-shadow: none; }
.bn-button:hover:not(:disabled) { background: var(--bn-accent-soft); border-color: var(--bn-accent); color: var(--bn-accent-hover); text-decoration: none; }
.bn-button:focus-visible { outline: 2px solid var(--bn-accent); outline-offset: 3px; }
.bn-button:disabled { cursor: default; opacity: .55; }
.bn-tool-status { color: var(--bn-muted); font: 13px/1.5 var(--bn-font); }
.bn-recovery { color: var(--bn-text); background: var(--bn-surface); border: 1px solid var(--bn-border); border-radius: var(--bn-radius-lg); padding: 20px; box-shadow: var(--bn-shadow); font: 14px/1.5 var(--bn-font); }
.bn-recovery p { margin: 0 0 12px; }
@media (max-width: 480px), (pointer: coarse) { .bn-button { min-height: 44px; } }
@media (forced-colors: active) { .bn-button:focus-visible { outline-color: Highlight; } .bn-button:disabled { opacity: 1; color: GrayText; } }
`;

// Layout selectors require reversible adapter markers. Unknown page/row
// structures retain native layout; colors and controls keep native actions.
const PAGE_STYLES = `
html[data-blackbaud-next-appearance][data-bn-portal-shell] body { background: var(--bn-page); color: var(--bn-text); font-family: var(--bn-font); }
html[data-blackbaud-next-appearance][data-bn-portal-shell="legacy"] :is(#site-main-header, #site-main) { box-sizing: border-box; width: calc(100% - var(--bn-shell-gutter) * 2); max-width: var(--bn-shell-max-width); margin-left: auto; margin-right: auto; padding-inline: var(--bn-shell-inset); }
html[data-blackbaud-next-appearance][data-bn-portal-shell="legacy"] #site-main { padding-top: 0; padding-bottom: 24px; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page] { font: 14px/1.5 var(--bn-font); color: var(--bn-text); }
html[data-blackbaud-next-appearance] #site-main[data-bn-page] :is(h1, h2, h3, h4, h5, .bb-page-heading) { font-family: var(--bn-font); color: var(--bn-text); line-height: 1.35; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page] :is(h1, .bb-page-heading) { font-size: 28px; font-weight: 600; letter-spacing: -.4px; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page] :is(.bb-tile, .well) { border: 1px solid var(--bn-border); border-radius: var(--bn-radius-lg); background: var(--bn-surface); box-shadow: var(--bn-shadow); }
html[data-blackbaud-next-appearance] #site-main[data-bn-page] .bb-tile-title { border-radius: var(--bn-radius-lg) var(--bn-radius-lg) 0 0; border-top: 0; border-bottom: 1px solid var(--bn-border); padding: 18px 20px; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page] .bb-tile-header { font-size: 20px; font-weight: 600; letter-spacing: -.2px; line-height: 1.35; margin: 0; }
/* Replace native floated title/tools only for the complete two-column header. */
html[data-blackbaud-next-appearance] #site-main[data-bn-page] .bb-tile-title:has(> .bb-tile-header-with-content:first-child + .bb-tile-header-column-tools:last-child) { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page] .bb-tile-title:has(> .bb-tile-header-with-content:first-child + .bb-tile-header-column-tools:last-child)::before,
html[data-blackbaud-next-appearance] #site-main[data-bn-page] .bb-tile-title:has(> .bb-tile-header-with-content:first-child + .bb-tile-header-column-tools:last-child)::after { display: none; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page] .bb-tile-title:has(> .bb-tile-header-with-content:first-child + .bb-tile-header-column-tools:last-child) > :is(.bb-tile-header-with-content, .bb-tile-header-column-tools) { float: none; width: auto; min-width: 0; max-width: none !important; padding: 0; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page] .bb-tile-title:has(> .bb-tile-header-with-content:first-child + .bb-tile-header-column-tools:last-child) .bb-tile-header { padding: 0; overflow-wrap: anywhere; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page] .bb-tile-title:has(> .bb-tile-header-with-content:first-child + .bb-tile-header-column-tools:last-child) .bb-tile-tools { display: flex; align-items: center; float: none; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page] .bb-tile-title:has(> .bb-tile-header-with-content:first-child + .bb-tile-header-column-tools:last-child) button.bb-tile-chevron { float: none; margin: 0; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page] .bb-tile-tools button.bb-tile-chevron { width: 32px; height: 32px; border-radius: 6px; color: var(--bn-muted); }
html[data-blackbaud-next-appearance] #site-main[data-bn-page] .bb-tile-tools button.bb-tile-chevron:hover { background: var(--bn-accent-soft); color: var(--bn-accent); }
html[data-blackbaud-next-appearance] #site-main[data-bn-page] .bb-tile-content { padding: 20px; border-radius: 0 0 var(--bn-radius-lg) var(--bn-radius-lg); }
/* The verified outer content already supplies the card's inset. */
html[data-blackbaud-next-appearance] #site-main[data-bn-page] .bb-tile > .bb-tile-content:has(> .bb-tile-content-section:only-child) > .bb-tile-content-section { padding: 0; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page] :is(a:not(.btn):not(.bn-button), .group-owner-name a) { color: var(--bn-accent); }
html[data-blackbaud-next-appearance] #site-main[data-bn-page] a:not(.btn):not(.bn-button):hover { color: var(--bn-accent-hover); }
html[data-blackbaud-next-appearance] #site-main[data-bn-page] :is(.btn, .form-control, select.input-sm) { font-family: var(--bn-font); border-radius: var(--bn-radius); box-shadow: none; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page] .btn-default { background: var(--bn-surface); border: 1px solid var(--bn-border-strong); color: var(--bn-text); }
html[data-blackbaud-next-appearance] #site-main[data-bn-page] .btn-default:hover { background: var(--bn-accent-soft); border-color: var(--bn-accent); color: var(--bn-accent-hover); }
html[data-blackbaud-next-appearance] #site-main[data-bn-page] .btn-default:is(.active, [aria-pressed="true"]) { background: var(--bn-accent-soft); color: var(--bn-accent); border-color: var(--bn-accent); }
html[data-blackbaud-next-appearance] #site-main[data-bn-page] .btn-primary { background: var(--bn-accent); border-color: var(--bn-accent); color: #fff; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page] .btn-primary:hover { background: var(--bn-accent-hover); border-color: var(--bn-accent-hover); }
html[data-blackbaud-next-appearance] #site-main[data-bn-page] :is(input.form-control, select.form-control, textarea.form-control, select.input-sm) { background: var(--bn-surface); border-color: var(--bn-border-strong); color: var(--bn-text); }
html[data-blackbaud-next-appearance] #site-main[data-bn-page] .nav-tabs { border-bottom-color: var(--bn-border); }
html[data-blackbaud-next-appearance] #site-main[data-bn-page] .nav-tabs > li > a { padding: 12px 16px; border-radius: var(--bn-radius) var(--bn-radius) 0 0; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page] .nav-tabs > li.active > a { border-color: var(--bn-border) var(--bn-border) var(--bn-surface); background: var(--bn-surface); color: var(--bn-accent) !important; font-weight: 600; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page] .table { font-size: 14px; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page] .table > thead > tr > th { background: var(--bn-page); color: var(--bn-muted); font-size: 12px; font-weight: 600; padding: 12px; border-color: var(--bn-border); }
html[data-blackbaud-next-appearance] #site-main[data-bn-page] .table > tbody > tr > td { padding: 14px 12px; vertical-align: middle; border-color: var(--bn-border); }
html[data-blackbaud-next-appearance] #site-main[data-bn-page] .table-striped > tbody > tr:nth-of-type(odd) { background: #fafbfc; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page] :is(a, button, input, select, textarea):focus-visible { outline: 2px solid var(--bn-accent); outline-offset: 3px; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page="schedule"] #schedule-header :is(h2, .chCal-header-title) { font-size: 23px; font-weight: 600; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page="schedule"] #schedule-header > .container-fluid:has(> .row > .col-md-12 > .pull-right:first-child + div > div > .chCal-button-prev + .chCal-button-next) { padding-inline: 0; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page="schedule"] .bb-tile-title > div:only-child > h2.bb-tile-header:only-child { padding: 0; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page="schedule"] .chCal-state-default { background: var(--bn-surface); border-color: var(--bn-border-strong); color: var(--bn-text); box-shadow: none; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page="schedule"] .chCal-state-active { background: var(--bn-accent-soft); border-color: var(--bn-accent); color: var(--bn-accent); }
html[data-blackbaud-next-appearance] #site-main[data-bn-page="schedule"] #accordionSchedules h4 { font-size: 15px; font-weight: 600; margin: 0; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page="schedule"] #accordionSchedules .label { font-size: 12px; font-weight: 600; padding: 5px 9px; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page="schedule"] #accordionSchedules .label-success { background: #eaf5ed; color: #27613a; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page="class"] #academicclassnavmenu .bb-page-heading { margin: 8px 0 20px; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page="directory"] .bn-directory { background: var(--bn-surface); border: 1px solid var(--bn-border); border-radius: var(--bn-radius-lg); padding: 24px; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page="resources"] .boxTopic { border-color: var(--bn-border); border-radius: var(--bn-radius-lg); box-shadow: var(--bn-shadow); }
html[data-blackbaud-next-appearance] #site-main[data-bn-page="resources"] .boxTopic > .containerFull { border-color: var(--bn-border); border-radius: var(--bn-radius-lg); box-shadow: var(--bn-shadow); }
html[data-blackbaud-next-appearance] #site-main[data-bn-page="resources"] .boxTopic > .containerFull > img { border-radius: 11px 11px 0 0; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page="resources"] .boxTopic :is(h3, .header) { font-family: var(--bn-font); }
html[data-blackbaud-next-appearance] #site-login-box:has(#site-login-form #Username) { max-width: calc(100vw - 32px); border: 1px solid var(--bn-border); border-radius: var(--bn-radius-lg); box-shadow: var(--bn-shadow); }
html[data-blackbaud-next-appearance] #site-login-input :is(input[type="text"], input[type="email"], input[type="password"]) { border-radius: var(--bn-radius); border-color: var(--bn-border-strong); }
html[data-blackbaud-next-appearance] body[data-bn-page="assignments"] { background: var(--bn-page); }
html[data-blackbaud-next-appearance] body[data-bn-page="assignments"] :is(sky-toolbar, sky-repeater-item.assignment-repeater-item) { font-family: var(--bn-font); }
html[data-blackbaud-next-appearance] body[data-bn-page="assignments"] sky-toolbar { border-color: var(--bn-border); background: var(--bn-surface); }
html[data-blackbaud-next-appearance] body[data-bn-page="assignments"] sky-repeater-item.assignment-repeater-item { border-color: var(--bn-border); background: var(--bn-surface); }
html[data-blackbaud-next-appearance] body[data-bn-page="assignments"] app-assignment-title-link a { color: var(--bn-accent); }
@media (max-width: 700px) {
  html[data-blackbaud-next-appearance] #site-main[data-bn-page] .bb-tile-title { padding: 16px; }
  html[data-blackbaud-next-appearance] #site-main[data-bn-page] .bb-tile-content { padding: 16px; }
  html[data-blackbaud-next-appearance] #site-main[data-bn-page] .bb-tile-tools button.bb-tile-chevron { width: 44px; height: 44px; }
  html[data-blackbaud-next-appearance] #site-main[data-bn-page="schedule"] #schedule-header .container-fluid > .row > .col-md-12 > .pull-right:first-child + div > div:has(> .chCal-button-prev + .chCal-button-next) > h2 { display: block !important; clear: both; margin: 12px 0 0; }
  html[data-blackbaud-next-appearance] #site-main[data-bn-page] .table > :is(thead, tbody) > tr > :is(td, th) { padding: 10px 8px; }
  html[data-blackbaud-next-appearance] #site-main[data-bn-page="directory"] .bn-directory { padding: 16px; }
  html[data-blackbaud-next-appearance] #site-main[data-bn-page="resources"] .boxTopic { max-width: calc(100% - 10px); }
  html[data-blackbaud-next-appearance] #site-main[data-bn-page="resources"] .boxTopic > .containerFull { max-width: 100%; }
}
@media (forced-colors: active) {
  html[data-blackbaud-next-appearance] #site-main[data-bn-page] :is(.bb-tile, .well) { border-color: CanvasText; box-shadow: none; }
  html[data-blackbaud-next-appearance] #site-main[data-bn-page] :is(a, button, input, select, textarea):focus-visible { outline-color: Highlight; }
}
${PROGRESS_STYLES}
`;

export const toolStylesFeature: Feature = {
  id: 'tool-styles',
  settingsKeys: [],
  routeScope: 'document',
  enabled: () => true,
  matches: isSchoolPage,
  mount: () => addStyle('tools', TOOL_STYLES),
};

export const pageAppearanceFeature: Feature = {
  id: 'page-appearance',
  settingsKeys: [],
  routeScope: 'document',
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
