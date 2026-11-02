const page = 'html[data-blackbaud-next-appearance] app-assignment-view[data-bn-page="assignment"]';
const header = `${page} > div > div > app-assignment-view-details > .header`;
const heading = `${header} > div:first-child`;
const metadata = `${header} > div > sky-fluid-grid`;
const content = `${page} > div > .sky-theme-padding-inset-balanced-m`;
const card = `${content} sky-box > section.sky-box:has(> .sky-box-header-content + sky-box-content:last-child)`;

export const ASSIGNMENT_DETAIL_STYLES = `
${page} { color: var(--bn-text); font: 14px/1.5 var(--bn-font); }
${header} { box-sizing: border-box; width: 100%; padding: 0 24px 20px; }
${heading} { margin-bottom: 20px; }
${heading}:not([hidden]):has(> h1:first-child + sky-help-inline:last-child) { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; gap: 16px; }
${heading} > sky-help-inline.pull-right { float: none; }
${heading} > h1:not([hidden]) { display: block; min-width: 0; margin: 0; color: var(--bn-muted); font: 400 14px/1.5 var(--bn-font); }
${heading} > h1 > a { color: var(--bn-accent); font: inherit; }
${heading} > h1 > a:hover { color: var(--bn-accent-hover); }
${heading} > h1 > span:not([hidden]) { display: block; margin-top: 6px; color: var(--bn-text); font: 600 28px/1.3 var(--bn-font); letter-spacing: -.4px; overflow-wrap: anywhere; }
${header} > div:has(> sky-fluid-grid) { margin-bottom: 0; }
${metadata} > .sky-fluid-grid { max-width: 1120px; padding-inline: 0; }
${metadata} > .sky-fluid-grid > sky-row > .sky-row { margin-inline: 0; }
${metadata} > .sky-fluid-grid > sky-row > .sky-row > sky-column { padding-inline: 0; }
${metadata} dl.sky-description-list { margin-bottom: -12px; }
${metadata} .sky-description-list-content { padding-right: 24px; margin-bottom: 12px; }
${metadata} .sky-description-list-content > dt { margin-bottom: 3px; color: var(--bn-muted); font: 400 12px/1.5 var(--bn-font); }
${metadata} .sky-description-list-content > dd { font: 400 14px/1.5 var(--bn-font); overflow-wrap: anywhere; }
${metadata} .sky-description-list-description > .flex-wrapper { font-weight: 600; }
${metadata} .sky-description-list-description > .flex-wrapper > .sky-font-deemphasized { color: var(--bn-muted); font: 400 13px/1.5 var(--bn-font); }
${metadata} .sky-description-list-description > .display-flex > button.sky-btn { font-weight: 600; }
${content} { padding: 24px; }
${content} > sky-fluid-grid > .sky-fluid-grid { padding-inline: 0; }
/* Native empty placeholder for optional sidebar content. Keep its spacing as
   soon as Blackbaud adds anything, including content we do not recognize. */
${content} > sky-fluid-grid > .sky-fluid-grid > sky-row > .sky-row > sky-column.sky-column-sm-3 > div.sky-theme-margin-bottom-xl:first-child:empty { margin-bottom: 0; }
${card} { border: 1px solid var(--bn-border); border-radius: var(--bn-radius-lg); background: var(--bn-surface); box-shadow: var(--bn-shadow); }
${card} > .sky-box-header-content { padding: 18px 20px 0; }
${card} > .sky-box-header-content h2.sky-font-heading-2 { margin: 0; color: var(--bn-text); font: 600 18px/1.4 var(--bn-font); letter-spacing: -.2px; }
${card} > sky-box-content > .sky-box-content { padding: 16px 20px 20px; }
${heading} > h1 > a:focus-visible { outline: 2px solid var(--bn-accent); outline-offset: 3px; }
@media (max-width: 700px) {
  ${header} { padding-inline: 16px; }
  ${heading} > h1 > span:not([hidden]) { font-size: 24px; }
  ${metadata} .sky-description-list-content { padding-right: 12px; }
  ${content} { padding: 20px 16px; }
  ${card} > .sky-box-header-content { padding: 16px 16px 0; }
  ${card} > sky-box-content > .sky-box-content { padding: 14px 16px 16px; }
}
@media (forced-colors: active) {
  ${card} { border-color: CanvasText; box-shadow: none; }
  ${heading} > h1 > a:focus-visible { outline-color: Highlight; }
}
`;
