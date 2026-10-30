import { DIRECTORY_NATIVE_ATTRIBUTE, DIRECTORY_UI_ATTRIBUTE } from '../blackbaud/directory-protocol.ts';

export const directoryStyles = `
[${DIRECTORY_NATIVE_ATTRIBUTE}] > :not(#overview):not([${DIRECTORY_UI_ATTRIBUTE}]) { display: none !important; }
.bn-directory, .bn-directory-notice { color: var(--bn-text); font: 14px/1.5 var(--bn-font); }
.bn-directory { margin: 16px 0; padding: 0; border: 0; background: transparent; }
.bn-directory h2 { position: absolute; width: 1px; height: 1px; overflow: hidden; padding: 0; margin: -1px; clip-path: inset(50%); white-space: nowrap; }
.bn-directory-heading, .bn-directory-actions, .bn-directory-pagination, .bn-directory-notice { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.bn-directory-heading { justify-content: flex-end; margin-bottom: 16px; }
.bn-directory-controls { display: grid; grid-template-columns: minmax(180px, 2fr) repeat(2, minmax(130px, 1fr)); gap: 16px; margin-bottom: 16px; }
.bn-directory-controls-no-grades { grid-template-columns: minmax(180px, 2fr) minmax(130px, 1fr); }
.bn-directory-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.bn-directory-field > span { font-size: 13px; font-weight: 600; }
.bn-directory input, .bn-directory select { box-sizing: border-box; width: 100%; min-height: 40px; border: 1px solid var(--bn-border-strong); border-radius: var(--bn-radius); padding: 8px 12px; background: var(--bn-surface); color: var(--bn-text); font: inherit; }
.bn-directory .bn-button, .bn-directory-notice .bn-button { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: 8px; max-width: 100%; min-height: 36px; border: 1px solid var(--bn-border-strong); border-radius: var(--bn-radius); padding: 4px 12px; background: var(--bn-surface); color: var(--bn-text); font: inherit; font-weight: 600; white-space: normal; cursor: pointer; }
.bn-directory .bn-button:hover:not(:disabled), .bn-directory-notice .bn-button:hover:not(:disabled) { background: var(--bn-accent-soft); border-color: var(--bn-accent); color: var(--bn-accent-hover); }
.bn-directory .bn-button:disabled { opacity: .5; cursor: default; }
.bn-directory :is(input, select):disabled { background: var(--bn-page); color: var(--bn-muted); }
.bn-directory :is(a, button, input, select):focus-visible, .bn-directory-notice button:focus-visible { outline: 2px solid var(--bn-accent); outline-offset: 3px; }
.bn-directory [hidden], .bn-directory-notice [hidden] { display: none !important; }
.bn-directory-count { margin: 0 0 8px; color: var(--bn-muted); font-size: 13px; }
.bn-directory-limit { margin: 0 0 12px; padding: 8px 12px; border-radius: var(--bn-radius); background: var(--bn-accent-soft); color: var(--bn-text); }
.bn-directory-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); list-style: none; margin: 0; padding: 0; gap: 0 24px; }
.bn-directory-row { display: flex; align-items: center; min-width: 0; gap: 12px; padding: 12px 0; border-top: 1px solid var(--bn-border); }
.bn-directory-avatar { position: relative; flex: 0 0 48px; width: 48px; height: 48px; overflow: hidden; border-radius: 50%; background: var(--bn-accent-soft); color: var(--bn-accent-hover); text-decoration: none; }
.bn-directory-initials { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; font-weight: 600; }
.bn-directory-avatar img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.bn-directory-person { min-width: 0; flex: 1; }
.bn-directory-name { font-size: 15px; font-weight: 600; overflow-wrap: anywhere; }
.bn-directory a { color: var(--bn-accent); }
.bn-directory a:hover { color: var(--bn-accent-hover); }
.bn-directory a:not(.bn-directory-avatar):is(:hover, :focus-visible) { text-decoration: underline; }
.bn-directory-grade { color: var(--bn-muted); font-size: 13px; }
.bn-directory-email { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 4px; font-size: 13px; }
.bn-directory-email > a { min-width: 0; overflow-wrap: anywhere; }
.bn-directory-email .bn-button { flex-shrink: 0; min-height: 28px; padding: 4px 8px; font-size: 12px; }
.bn-directory-empty { padding: 32px 16px; border-top: 1px solid var(--bn-border); text-align: center; color: var(--bn-muted); }
.bn-directory-empty p { margin: 0 0 12px; }
.bn-directory-pagination { justify-content: flex-end; border-top: 1px solid var(--bn-border); padding-top: 16px; margin-top: 0; }
.bn-directory-pagination > span { padding: 0 4px; color: var(--bn-muted); font-size: 13px; }
.bn-directory-feedback { min-height: 1.5em; margin: 8px 0 0; color: var(--bn-muted); font-size: 13px; }
.bn-directory-feedback:empty { min-height: 0; margin: 0; }
.bn-directory-notice { margin: 12px 0; padding: 12px; border: 1px solid var(--bn-border); border-radius: var(--bn-radius); background: var(--bn-page); }
.bn-directory-notice p { min-width: 0; margin: 0; flex: 1 1 240px; overflow-wrap: anywhere; }
@media (max-width: 900px) { .bn-directory-controls { grid-template-columns: repeat(2, minmax(0, 1fr)); } .bn-directory-field:first-child { grid-column: 1 / -1; } .bn-directory-controls-no-grades .bn-directory-field:first-child { grid-column: auto; } .bn-directory-list { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 480px) { .bn-directory { margin: 12px 0; } .bn-directory-controls { grid-template-columns: minmax(0, 1fr); gap: 12px; } .bn-directory-heading { justify-content: flex-start; } .bn-directory-actions { width: 100%; } .bn-directory-pagination { justify-content: center; } }
@media (max-width: 480px), (pointer: coarse) { .bn-directory :is(input, select), .bn-directory .bn-button, .bn-directory-email .bn-button, .bn-directory-notice .bn-button { min-height: 44px; } }
`;
