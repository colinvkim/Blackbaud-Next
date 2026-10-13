// These rules style the native nodes in place. Only the complete, verified
// course list receives Cards layout; individual known rows retain a full-width
// layout when an unfamiliar sibling prevents list recognition.
export const PROGRESS_STYLES = `
html[data-blackbaud-next-appearance] #site-main[data-bn-page="progress"] :is(h1, .bb-page-heading) { font-size: 25px; font-weight: 500; letter-spacing: -.3px; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page="progress"] .well-sm { padding: 12px 16px; font-size: 13px; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page="progress"] .well-sm:not([hidden]):has(> label[for="gradeSelect"]:first-child + select#gradeSelect:last-child) { display: inline-flex; align-items: center; gap: 8px; max-width: 100%; padding: 8px 12px; margin-bottom: 20px; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page="progress"] .well-sm > label[for="gradeSelect"] { margin: 0; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page="progress"] #gradeSelect { min-height: 36px; max-width: 100%; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page="progress"] [data-bn-progress-summary="true"]:not([hidden]) { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; gap: 16px; margin: 0 0 24px; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page="progress"] [data-bn-progress-summary="true"]::before,
html[data-blackbaud-next-appearance] #site-main[data-bn-page="progress"] [data-bn-progress-summary="true"]::after { display: none; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page="progress"] [data-bn-progress-summary="true"] > div > .ch.col-md-4 { float: none; width: 100%; min-width: 0; padding: 0; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page="progress"] [data-bn-progress-summary="true"] .bb-tile { margin-bottom: 0; border-radius: var(--bn-radius); box-shadow: none; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page="progress"] [data-bn-progress-summary="true"] .bb-tile-title { padding: 14px 16px; border-bottom: 0; border-radius: var(--bn-radius) var(--bn-radius) 0 0; background: var(--bn-surface); }
html[data-blackbaud-next-appearance] #site-main[data-bn-page="progress"] [data-bn-progress-summary="true"] .bb-tile-header { font-size: 15px; font-weight: 600; letter-spacing: 0; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page="progress"] [data-bn-progress-summary="true"] .bb-tile-tools button.bb-tile-chevron { border: 0; background: transparent; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page="progress"] [data-bn-progress-summary="true"] .bb-tile-tools button.bb-tile-chevron:hover { background: var(--bn-accent-soft); }
html[data-blackbaud-next-appearance] #site-main[data-bn-page="progress"] [data-bn-progress-summary="true"] .bb-tile-content { padding: 0 16px 16px; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page="progress"] [data-bn-course-row="true"]:not([hidden]) { display: grid; grid-template-columns: minmax(180px, 1.8fr) minmax(0, .25fr) minmax(150px, 1fr) minmax(0, .45fr) minmax(170px, 1.15fr); gap: 20px; margin: 0; padding: 20px 0; border-bottom: 1px solid var(--bn-border); background: var(--bn-surface) !important; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page="progress"] [data-bn-course-row="true"]::before,
html[data-blackbaud-next-appearance] #site-main[data-bn-page="progress"] [data-bn-course-row="true"]::after { display: none; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page="progress"] [data-bn-course-row="true"] > :is(.col-md-2, .col-md-3) { float: none; width: auto; min-width: 0; padding: 0; overflow-wrap: anywhere; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page="progress"] [data-bn-course-row="true"] > :first-child h3 { font-size: 17px; font-weight: 500; line-height: 1.4; margin: 0 0 6px; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page="progress"] [data-bn-course-row="true"] :is(h4, .group-owner-name) { font-size: 14px; font-weight: 500; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page="progress"] [data-bn-course-row="true"] h5 { font-size: 12px; line-height: 1.5; color: var(--bn-muted); font-weight: 400; margin: 0 0 8px; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page="progress"] [data-bn-course-row="true"] .showGrade { font-size: 20px; line-height: 1.4; white-space: normal; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page="progress"] [data-bn-course-row="true"] .showGrade + h5 { margin-top: 6px; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page="progress"] [data-bn-course-row="true"] .bb-avatar-image-medium { width: 40px; height: 40px; object-fit: cover; }
/* Compact only the complete native photo/name/email/message structure. */
html[data-blackbaud-next-appearance] #site-main[data-bn-page="progress"] [data-bn-course-row="true"] > :last-child:not([hidden]):has(> div.bb-avatar-wrapper-medium.pull-left:first-child + div.clearfix:empty + h4.group-owner-name + p + button.sendmessage:last-child):has(> p > a[href^="mailto:"]) { display: grid; grid-template-columns: 40px minmax(0, 1fr); gap: 4px 12px; align-content: start; align-items: start; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page="progress"] [data-bn-course-row="true"] > :last-child:has(> div.bb-avatar-wrapper-medium.pull-left:first-child + div.clearfix:empty + h4.group-owner-name + p + button.sendmessage:last-child):has(> p > a[href^="mailto:"]) > .bb-avatar-wrapper-medium { grid-column: 1; grid-row: 1 / 4; float: none !important; width: 40px; height: 40px; margin: 0; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page="progress"] [data-bn-course-row="true"] > :last-child:has(> div.bb-avatar-wrapper-medium.pull-left:first-child + div.clearfix:empty + h4.group-owner-name + p + button.sendmessage:last-child):has(> p > a[href^="mailto:"]) > .clearfix:empty { display: none; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page="progress"] [data-bn-course-row="true"] > :last-child:has(> div.bb-avatar-wrapper-medium.pull-left:first-child + div.clearfix:empty + h4.group-owner-name + p + button.sendmessage:last-child):has(> p > a[href^="mailto:"]) > :is(h4.group-owner-name, p, button.sendmessage) { grid-column: 2; min-width: 0; margin: 0; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page="progress"] [data-bn-course-row="true"] > :last-child:has(> div.bb-avatar-wrapper-medium.pull-left:first-child + div.clearfix:empty + h4.group-owner-name + p + button.sendmessage:last-child):has(> p > a[href^="mailto:"]) > p { font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page="progress"] [data-bn-course-row="true"] > :last-child:has(> div.bb-avatar-wrapper-medium.pull-left:first-child + div.clearfix:empty + h4.group-owner-name + p + button.sendmessage:last-child):has(> p > a[href^="mailto:"]) > button.sendmessage { justify-self: start; max-width: 100%; width: auto; margin-top: 4px; padding: 5px 9px; font-size: 13px; white-space: normal; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page="progress"] [data-bn-progress-courses="cards"]:not([hidden]) { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; gap: 16px; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page="progress"] [data-bn-progress-courses="cards"]::before,
html[data-blackbaud-next-appearance] #site-main[data-bn-page="progress"] [data-bn-progress-courses="cards"]::after { display: none; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page="progress"] [data-bn-progress-courses="cards"] > [data-bn-course-row="true"]:not([hidden]) { box-sizing: border-box; grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr) minmax(0, 1fr); gap: 12px 16px; padding: 20px; border: 1px solid var(--bn-border); border-radius: var(--bn-radius); box-shadow: none; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page="progress"] [data-bn-progress-courses="cards"] > [data-bn-course-row="true"] > :is(:first-child, :last-child) { grid-column: 1 / -1; }
/* Keep each native column in its slot when a neighboring column is hidden. */
html[data-blackbaud-next-appearance] #site-main[data-bn-page="progress"] [data-bn-progress-courses="cards"] > [data-bn-course-row="true"] > :nth-child(2) { grid-column: 1; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page="progress"] [data-bn-progress-courses="cards"] > [data-bn-course-row="true"] > :nth-child(3) { grid-column: 2; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page="progress"] [data-bn-progress-courses="cards"] > [data-bn-course-row="true"] > :nth-child(4) { grid-column: 3; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page="progress"] [data-bn-progress-courses="cards"] > [data-bn-course-row="true"] > :last-child { border-top: 1px solid var(--bn-border); padding-top: 16px; margin-top: 4px; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page="progress"] [data-bn-progress-courses="cards"] :is(select, input, textarea, .btn) { box-sizing: border-box; min-width: 0; max-width: 100%; }
html[data-blackbaud-next-appearance] #site-main[data-bn-page="progress"] [data-bn-progress-courses="cards"] .btn { white-space: normal; }
@media (max-width: 1099px) {
  html[data-blackbaud-next-appearance] #site-main[data-bn-page="progress"] [data-bn-progress-courses="cards"]:not([hidden]) { grid-template-columns: minmax(0, 1fr); }
  html[data-blackbaud-next-appearance] #site-main[data-bn-page="progress"] [data-bn-course-row="true"]:not([hidden]) { grid-template-columns: minmax(0, 1fr); gap: 16px; }
}
@media (max-width: 700px) {
  html[data-blackbaud-next-appearance] #site-main[data-bn-page="progress"] [data-bn-progress-summary="true"]:not([hidden]) { grid-template-columns: minmax(0, 1fr); gap: 12px; margin-bottom: 20px; }
  html[data-blackbaud-next-appearance] #site-main[data-bn-page="progress"] [data-bn-progress-courses="cards"] > [data-bn-course-row="true"]:not([hidden]) { grid-template-columns: minmax(0, 1fr); padding: 16px; }
  html[data-blackbaud-next-appearance] #site-main[data-bn-page="progress"] [data-bn-progress-courses="cards"] > [data-bn-course-row="true"] > :is(:nth-child(2), :nth-child(3), :nth-child(4)) { grid-column: 1 / -1; }
  html[data-blackbaud-next-appearance] #site-main[data-bn-page="progress"] .well-sm:has(> label[for="gradeSelect"]:first-child + select#gradeSelect:last-child) { flex-wrap: wrap; }
}
@media (max-width: 480px), (pointer: coarse) {
  html[data-blackbaud-next-appearance] #site-main[data-bn-page="progress"] [data-bn-course-row="true"] :is(.btn, select, button.sendmessage) { min-height: 44px; }
}
@media (forced-colors: active) {
  html[data-blackbaud-next-appearance] #site-main[data-bn-page="progress"] [data-bn-progress-courses="cards"] > [data-bn-course-row="true"]:not([hidden]) { border-color: CanvasText; }
}
`;
