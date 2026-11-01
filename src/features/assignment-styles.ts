const page = 'html[data-blackbaud-next-appearance] body[data-bn-page="assignments"]';
const row = `${page} sky-repeater-item.assignment-repeater-item`;
const title = `${row} sky-repeater-item-title:has(> .assignment-center-middle-block > div:first-child > app-assignment-title-link):has(> .assignment-center-middle-block > div.assignment-details.sky-font-deemphasized):has(> .right-block > .display-inline)`;
const heading = `${page} app-student-assignment-center > div > .hide-for-print > .padding-left-15.padding-top-20:has(> h3:only-child)`;
const details = `${row} .assignment-center-middle-block > div.assignment-details.sky-font-deemphasized`;

export const ASSIGNMENT_STYLES = `${page} { background: var(--bn-page); }
${page} :is(sky-toolbar, sky-repeater-item.assignment-repeater-item) { font-family: var(--bn-font); }
${page} sky-toolbar { border-color: var(--bn-border); background: var(--bn-surface); }
${heading} { padding: 0 16px 16px; }
${heading} > h3 { margin: 0; }
${page} sky-toolbar > .sky-toolbar-container > sky-toolbar-section > .sky-toolbar-section:has(> .sky-toolbar-section-items) { padding-inline: 16px; }
${page} .bn-assignment-shortcuts { padding-inline: 16px; }
${page} sky-repeater-item:not(.assignment-repeater-item) > .sky-repeater-item-collapsible:has(> .sky-repeater-item-right > .sky-repeater-item-header h3) { padding-inline: 15px; }
${row} { border-color: var(--bn-border); background: var(--bn-surface); }
${page} app-assignment-title-link a { color: var(--bn-accent); }
/* Keep the title and status together while extra metadata grows the native row. */
${title} > :is(.assignment-center-middle-block, .right-block) { vertical-align: top; padding-block: 16px; }
${title} > .assignment-center-middle-block > div:first-child:not([hidden]),
${title} > .right-block > .display-inline:not([hidden]) { display: flex; align-items: center; min-height: 32px; }
${title} > .assignment-center-middle-block > div:first-child > app-assignment-title-link { min-width: 0; max-width: 100%; }
${details} { color: var(--bn-muted); font: 400 13px/1.5 var(--bn-font); overflow-wrap: anywhere; }
${details} > span > button.sky-btn-link-inline:has(> a[href]:only-child) { max-width: 100%; white-space: normal; }`;

export const ASSIGNMENT_RESPONSIVE_STYLES = `@media (max-width: 480px), (pointer: coarse) {
  ${title} > .assignment-center-middle-block > div:first-child:not([hidden]),
  ${title} > .right-block > .display-inline:not([hidden]) { min-height: 44px; }
}`;
