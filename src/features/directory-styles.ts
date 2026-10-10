import { DIRECTORY_NATIVE_ATTRIBUTE, DIRECTORY_UI_ATTRIBUTE } from '../blackbaud/directory-protocol.ts';

export const directoryStyles = `
[${DIRECTORY_NATIVE_ATTRIBUTE}] > :not(#overview):not([${DIRECTORY_UI_ATTRIBUTE}]) { display: none !important; }
.bn-directory, .bn-directory-notice { color: #24354b; font: 14px/1.5 system-ui, -apple-system, sans-serif; }
.bn-directory { margin: 18px 0; padding: 20px; border: 1px solid #dce3eb; border-radius: 12px; background: #fff; }
.bn-directory h2 { margin: 0; font: 600 20px/1.3 system-ui, -apple-system, sans-serif; }
.bn-directory-heading, .bn-directory-actions, .bn-directory-pagination, .bn-directory-notice { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.bn-directory-heading { justify-content: space-between; margin-bottom: 18px; }
.bn-directory-controls { display: grid; grid-template-columns: minmax(180px, 2fr) repeat(2, minmax(130px, 1fr)); gap: 12px; margin-bottom: 14px; }
.bn-directory-controls-no-grades { grid-template-columns: minmax(180px, 2fr) minmax(130px, 1fr); }
.bn-directory-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.bn-directory-field > span { font-weight: 600; }
.bn-directory input, .bn-directory select { box-sizing: border-box; width: 100%; min-height: 38px; border: 1px solid #b8c5d4; border-radius: 6px; padding: 7px 9px; background: #fff; color: #24354b; font: inherit; }
.bn-directory .bn-button, .bn-directory-notice .bn-button { min-height: 34px; border: 1px solid #b8c5d4; border-radius: 6px; padding: 5px 10px; background: #f8fafc; color: #24354b; font: inherit; cursor: pointer; }
.bn-directory .bn-button:disabled { opacity: .5; cursor: default; }
.bn-directory :is(a, button, input, select):focus-visible, .bn-directory-notice button:focus-visible { outline: 3px solid #316bb6; outline-offset: 3px; }
.bn-directory [hidden], .bn-directory-notice [hidden] { display: none !important; }
.bn-directory-count { margin: 0 0 8px; color: #52647b; }
.bn-directory-limit { margin: 0 0 12px; color: #52647b; }
.bn-directory-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); list-style: none; margin: 0; padding: 0; gap: 0 22px; }
.bn-directory-row { display: flex; align-items: center; min-width: 0; gap: 12px; padding: 13px 0; border-top: 1px solid #e8edf3; }
.bn-directory-avatar { position: relative; flex: 0 0 48px; width: 48px; height: 48px; overflow: hidden; border-radius: 50%; background: #e8eef6; color: #3a5476; text-decoration: none; }
.bn-directory-initials { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; font-weight: 600; }
.bn-directory-avatar img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.bn-directory-person { min-width: 0; flex: 1; }
.bn-directory-name { font-size: 15px; font-weight: 600; overflow-wrap: anywhere; }
.bn-directory a { color: #245da3; }
.bn-directory-grade { color: #52647b; }
.bn-directory-email { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 3px; }
.bn-directory-email > a { min-width: 0; overflow-wrap: anywhere; }
.bn-directory-email .bn-button { min-height: 28px; padding: 1px 7px; font-size: 12px; }
.bn-directory-empty { padding: 28px 0; text-align: center; }
.bn-directory-empty p { margin: 0 0 12px; }
.bn-directory-pagination { justify-content: flex-end; border-top: 1px solid #e8edf3; padding-top: 14px; margin-top: 2px; }
.bn-directory-feedback { min-height: 1.5em; margin: 10px 0 0; color: #52647b; }
.bn-directory-notice { margin: 12px 0; padding: 10px 12px; border: 1px solid #dce3eb; border-radius: 8px; background: #f8fafc; }
.bn-directory-notice p { margin: 0; flex: 1 1 240px; }
@media (max-width: 900px) { .bn-directory-controls { grid-template-columns: repeat(2, minmax(0, 1fr)); } .bn-directory-list { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 480px) { .bn-directory { padding: 14px; } .bn-directory-controls { grid-template-columns: minmax(0, 1fr); } .bn-directory-heading { align-items: flex-start; } .bn-directory-pagination { justify-content: center; } }
`;
