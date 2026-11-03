import { DIRECTORY_NATIVE_ATTRIBUTE, DIRECTORY_UI_ATTRIBUTE } from '../blackbaud/directory-protocol.ts';
import { selectStyles } from '../shared/select-styles.ts';

export const directoryStyles = `
[${DIRECTORY_NATIVE_ATTRIBUTE}] > :not(#overview):not([${DIRECTORY_UI_ATTRIBUTE}]) { display: none !important; }
.bn-directory, .bn-directory-notice { color: var(--bn-text); font: 14px/1.5 var(--bn-font); }
.bn-directory { margin: 16px 0; padding: 0; border: 0; background: transparent; }
.bn-directory h2 { position: absolute; width: 1px; height: 1px; overflow: hidden; padding: 0; margin: -1px; clip-path: inset(50%); white-space: nowrap; }
.bn-directory-pagination, .bn-directory-notice { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.bn-directory-heading { margin-bottom: 20px; }
.bn-directory-controls { display: grid; grid-template-columns: minmax(160px, 1fr) 160px 160px; gap: 12px; min-width: 0; }
.bn-directory-controls-no-grades { grid-template-columns: minmax(160px, 1fr) 160px; }
.bn-directory-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; margin: 0; font-weight: 400; }
.bn-directory-field > span { font-size: 13px; font-weight: 600; }
.bn-directory input, .bn-directory select { box-sizing: border-box; width: 100%; min-height: 40px; border: 1px solid var(--bn-border-strong); border-radius: var(--bn-radius); padding: 8px 12px; background: var(--bn-surface); color: var(--bn-text); font: 400 14px/1.5 var(--bn-font); }
.bn-directory input::placeholder { color: var(--bn-muted); font-style: normal; opacity: 1; }
.bn-directory .bn-button, .bn-directory-notice .bn-button { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: 8px; max-width: 100%; min-height: 36px; border: 1px solid var(--bn-border-strong); border-radius: var(--bn-radius); padding: 4px 12px; background: var(--bn-surface); color: var(--bn-text); font: inherit; font-weight: 600; white-space: normal; cursor: pointer; }
.bn-directory .bn-button:hover:not(:disabled), .bn-directory-notice .bn-button:hover:not(:disabled) { background: var(--bn-accent-soft); border-color: var(--bn-accent); color: var(--bn-accent-hover); }
.bn-directory .bn-button:disabled { opacity: .5; cursor: default; }
.bn-directory :is(input, select):disabled { background: var(--bn-page); color: var(--bn-muted); }
.bn-directory :is(a, button, input, select, summary):focus-visible, .bn-directory-notice button:focus-visible { outline: 2px solid var(--bn-accent); outline-offset: 3px; }
.bn-directory [hidden], .bn-directory-notice [hidden] { display: none !important; }
.bn-directory-results-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; margin-bottom: 8px; }
.bn-directory-count { flex: 1 1 240px; min-width: 0; margin: 0; color: var(--bn-muted); font-size: 13px; }
.bn-directory-views { display: inline-flex; flex-shrink: 0; gap: 4px; margin-left: auto; }
.bn-directory-views .bn-button { min-height: 32px; padding: 4px 10px; font-size: 13px; }
.bn-directory-views .bn-button[aria-pressed="true"] { background: var(--bn-accent-soft); border-color: var(--bn-accent); color: var(--bn-accent-hover); }
.bn-directory-views .bn-button:not([aria-pressed="true"]):hover { background: var(--bn-page); border-color: var(--bn-border-strong); color: var(--bn-text); }
.bn-directory-limit { margin: 0 0 12px; padding: 8px 12px; border-radius: var(--bn-radius); background: var(--bn-accent-soft); color: var(--bn-text); }
.bn-directory-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); list-style: none; margin: 0; padding: 0; gap: 0 24px; }
.bn-directory-list[data-view="rows"] { grid-template-columns: minmax(0, 1fr); }
.bn-directory-row { display: flex; align-items: flex-start; min-width: 0; gap: 12px; padding: 12px 0; border-top: 1px solid var(--bn-border); }
.bn-directory-list[data-view="rows"] .bn-directory-row { padding: 16px 0; }
.bn-directory-avatar { position: relative; flex: 0 0 48px; width: 48px; height: 48px; overflow: hidden; border-radius: 50%; background: var(--bn-accent-soft); color: var(--bn-accent-hover); text-decoration: none; }
.bn-directory-initials { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; font-weight: 600; }
.bn-directory-avatar img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.bn-directory-person { min-width: 0; flex: 1; }
.bn-directory-identity { min-width: 0; }
.bn-directory-name { font-size: 15px; font-weight: 600; overflow-wrap: anywhere; }
.bn-directory a { color: var(--bn-accent); }
.bn-directory a:hover { color: var(--bn-accent-hover); }
.bn-directory a:not(.bn-directory-avatar):is(:hover, :focus-visible) { text-decoration: underline; }
.bn-directory-grade, .bn-directory-job-title { color: var(--bn-muted); font-size: 13px; }
.bn-directory-job-title { overflow-wrap: anywhere; }
.bn-directory-email { display: grid; grid-template-columns: minmax(0, auto) max-content; align-items: center; justify-content: start; gap: 4px; margin-top: 4px; font-size: 13px; }
.bn-directory-email > a { min-width: 0; overflow-wrap: anywhere; }
.bn-directory-email .bn-directory-copy { width: 28px; height: 28px; min-height: 28px; padding: 0; border-color: transparent; background: transparent; color: var(--bn-muted); }
.bn-directory-email .bn-directory-copy > .bn-icon { width: 16px; height: 16px; }
.bn-directory-email .bn-directory-copy:is(:hover, :focus-visible):not(:disabled) { border-color: transparent; background: var(--bn-page); color: var(--bn-accent-hover); }
.bn-directory-email .bn-directory-copy[data-copied] { color: var(--bn-accent); }
.bn-directory-copy-feedback { grid-column: 1 / -1; min-width: 0; color: var(--bn-text); font-size: 12px; overflow-wrap: anywhere; }
.bn-directory-copy-feedback:not([data-error]) { position: absolute; width: 1px; height: 1px; overflow: hidden; padding: 0; margin: -1px; clip-path: inset(50%); white-space: nowrap; }
.bn-directory-contact { margin-top: 4px; font-size: 13px; }
.bn-directory-contact > summary { box-sizing: border-box; display: inline-flex; align-items: center; gap: 4px; min-height: 28px; padding: 4px 0; color: var(--bn-accent); cursor: pointer; }
.bn-directory-contact > summary:hover { color: var(--bn-accent-hover); }
.bn-directory-contact > summary .bn-icon { width: 14px; height: 14px; }
.bn-directory-contact[open] > summary .bn-icon { transform: rotate(90deg); }
.bn-directory-contact > address { margin: 4px 0 0; color: var(--bn-text); font: inherit; white-space: pre-line; overflow-wrap: anywhere; }
.bn-directory-phones { margin: 4px 0 0; }
.bn-directory-phones > div { display: grid; grid-template-columns: 52px minmax(0, 1fr); gap: 8px; align-items: baseline; }
.bn-directory-phones dt { color: var(--bn-muted); font-weight: 400; }
.bn-directory-phones dd { min-width: 0; margin: 0; }
.bn-directory-phones a { box-sizing: border-box; display: inline-block; min-height: 28px; max-width: 100%; padding: 4px 0; overflow-wrap: anywhere; }
.bn-directory-empty { padding: 32px 16px; border-top: 1px solid var(--bn-border); text-align: center; color: var(--bn-muted); }
.bn-directory-empty p { margin: 0 0 12px; }
.bn-directory-pagination { justify-content: flex-end; border-top: 1px solid var(--bn-border); padding-top: 16px; margin-top: 0; }
.bn-directory-pagination > span { padding: 0 4px; color: var(--bn-muted); font-size: 13px; }
.bn-directory-feedback { min-height: 1.5em; margin: 8px 0 0; color: var(--bn-muted); font-size: 13px; }
.bn-directory-feedback:empty { min-height: 0; margin: 0; }
.bn-directory-notice { margin: 12px 0; padding: 12px; border: 1px solid var(--bn-border); border-radius: var(--bn-radius); background: var(--bn-page); }
.bn-directory-notice p { min-width: 0; margin: 0; flex: 1 1 240px; overflow-wrap: anywhere; }
.bn-directory-recovery, .bn-directory-loading-notice .bn-directory-original { visibility: hidden; animation: bn-directory-recovery 0s 8s forwards; }
.bn-directory .bn-directory-original, .bn-directory-notice .bn-directory-original { min-height: 28px; padding: 0; border: 0; border-radius: 0; background: transparent; color: var(--bn-accent); font-weight: 400; text-decoration: underline; text-underline-offset: 2px; }
.bn-directory .bn-directory-original:hover, .bn-directory-notice .bn-directory-original:hover { background: transparent; color: var(--bn-accent-hover); }
@keyframes bn-directory-recovery { to { visibility: visible; } }
${selectStyles('.bn-directory select')}
@media (min-width: 901px) {
  .bn-directory-list[data-view="rows"] .bn-directory-person { display: grid; grid-template-columns: minmax(160px, 1.1fr) minmax(0, 1fr) minmax(0, .9fr); align-items: start; gap: 12px 24px; }
  .bn-directory-list[data-view="rows"] .bn-directory-identity { grid-column: 1; grid-row: 1; }
  .bn-directory-list[data-view="rows"] .bn-directory-email { grid-column: 2; grid-row: 1; margin-top: 0; }
  .bn-directory-list[data-view="rows"] .bn-directory-contact { grid-column: 3; grid-row: 1; margin-top: 0; }
}
@media (max-width: 900px) { .bn-directory-list { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 700px) { .bn-directory-controls { grid-template-columns: repeat(2, minmax(0, 1fr)); } .bn-directory-field:first-child { grid-column: 1 / -1; } }
@media (max-width: 480px) { .bn-directory { margin: 12px 0; } .bn-directory-pagination { justify-content: center; } }
@media (max-width: 480px), (pointer: coarse) { .bn-directory :is(input, select), .bn-directory .bn-button, .bn-directory-email .bn-button, .bn-directory-contact > summary, .bn-directory-phones a, .bn-directory-notice .bn-button { min-height: 44px; } }
@media (max-width: 480px), (pointer: coarse) { .bn-directory-email .bn-directory-copy { width: 44px; height: 44px; } }
`;
