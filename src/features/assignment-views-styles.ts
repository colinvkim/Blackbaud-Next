import { THEME_TOKENS } from '../shared/theme.ts';

export const ASSIGNMENT_VIEWS_STYLES = `
.bn-classic-view-label { display: inline-flex; vertical-align: top; margin: 0 0 0 -1px; cursor: pointer; position: relative; }
.bn-classic-view-input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.bn-classic-view-label > span {
  display: inline-flex; gap: 6px; align-items: center; justify-content: center; height: 35px; padding: 0 10px;
  border: 1px solid #cdcfd2; border-radius: 0 3px 3px 0; background: #fff; color: #46515e; font: 500 14px var(--bn-font, Arial, sans-serif);
}
.bn-classic-view-label:hover > span { background: #f1f4f6; }
.bn-classic-view-input:checked + span { background: #eef6fa; color: #0066a1; border-color: #0066a1; }
.bn-classic-view-input:focus-visible + span { outline: 2px solid #0066a1; outline-offset: 2px; }
[data-bn-view-switch] .sky-switch-icon-group { display: flex; }
[data-bn-view-switch] sky-radio:last-of-type .sky-switch-control { border-top-right-radius: 0; border-bottom-right-radius: 0; }
[data-bn-classic-hidden] { display: none !important; }
.bn-classic-panel { display: block; clear: both; width: 100%; padding: 16px; box-sizing: border-box; }
.bn-classic-panel[hidden], .bn-classic-panel [hidden] { display: none !important; }
.bn-classic-frame { display: block; box-sizing: border-box; width: 100%; border: 1px solid var(--bn-border, #dde3e8); border-radius: 8px; background: #fff; }
.bn-classic-loading, .bn-classic-error { padding: 24px; color: var(--bn-muted, #657080); background: #fff; border: 1px solid var(--bn-border, #dde3e8); border-radius: 8px; }
.bn-classic-error p { margin: 0 0 12px; }
.bn-classic-error a { color: var(--bn-accent, #0066a1); }
.bn-classic-refresh-error { margin: 8px 16px; color: var(--bn-muted, #657080); font: 14px/1.5 var(--bn-font, Arial, sans-serif); }
.bn-classic-loading span { display: block; background: #edf0f3; border-radius: 4px; height: 16px; margin-bottom: 18px; width: 70%; }
.bn-classic-loading span:first-child { width: 40%; height: 30px; margin-bottom: 26px; }
.bn-classic-loading span:last-child { margin-bottom: 0; width: 55%; }
@media (max-width: 600px) { .bn-classic-panel { padding: 12px 8px; } }
`;

// This stylesheet is attached only to the validated, same-origin native frame.
// Native dialogs and conditional actions are retained, including mobile menus.
export const CLASSIC_FRAME_LAYOUT = `${THEME_TOKENS}
html { background: #fff; overflow-y: hidden; }
html, body { height: auto !important; min-height: 0 !important; }
body { background: #fff !important; margin: 0; color: #222a35; font-family: "Blackbaud Sans", "Helvetica Neue", Arial, sans-serif; }
#site-modal.modal { top: var(--bn-classic-viewport-top, 0px) !important; bottom: auto !important; height: var(--bn-classic-viewport-height, 100vh) !important; }
#site-modal.modal .modal-dialog { margin-block: 20px; }
#site-modal.modal .modal-content { display: flex; flex-direction: column; max-height: calc(var(--bn-classic-viewport-height, 100vh) - 40px); }
#site-modal.modal .modal-body { min-height: 0; overflow-y: auto; }
#site-modal.modal :is(.modal-header, .modal-footer) { flex-shrink: 0; }
#site-header-parent-container, #site-top-spacer, .site-main-header-wrap,
#site-footer, #site-sidebar-fixed, #site-mobile-menu { display: none !important; }
#app, .site-main-wrap { padding: 0 !important; margin: 0 !important; min-height: 0 !important; }
#site-main { width: 100% !important; max-width: none !important; margin: 0 !important; padding: 16px !important; }
#assignment-center .bb-tile { margin: 0; border: 0; box-shadow: none; background: #fff; }
#assignment-center .bb-tile > .bb-tile-title { display: none; }
#assignment-center .bb-tile-content, #assignment-center .bb-tile-content-section { padding: 0; border: 0; }
`;

export const CLASSIC_FRAME_STYLES = `${CLASSIC_FRAME_LAYOUT}
:is(#assignment-center-header-view, #calendar-header-container) .bb-action-bar { background: transparent; padding: 8px 0; border: 0; }
:is(#assignment-center-header-view, #calendar-header-container) h2 { font-size: 18px; font-weight: 600; margin: 0 0 12px; }
#assignment-center .btn { border-radius: 5px; box-shadow: none; font-size: 13px; line-height: 20px; }
#assignment-center .btn-default:not(.btn-danger) { background: var(--bn-surface); border-color: var(--bn-border-strong); color: var(--bn-text); }
#assignment-center .btn-default:not(.btn-danger):hover { background: var(--bn-page); }
#assignment-center .btn-default:not(.btn-danger).active { background: var(--bn-accent-soft); border-color: var(--bn-accent); color: var(--bn-accent); }
#assignment-center .btn-group > .btn { border-radius: 0; }
#assignment-center .btn-group > .btn:first-of-type { border-radius: 5px 0 0 5px; }
#assignment-center .btn-group > .btn:last-of-type { border-radius: 0 5px 5px 0; }
#assignment-center .btn-group > .btn:only-of-type { border-radius: 5px; }
#assignment-center .table { font-size: 14px; line-height: 1.45; margin-bottom: 16px; }
#assignment-center .table > thead > tr > th { background: #f5f6f8; color: #657080; border-bottom: 1px solid #dde3e8; font-size: 12px; font-weight: 600; padding: 10px 12px; }
#assignment-center .table > tbody > tr > td { padding: 14px 12px; vertical-align: middle; border-color: #e7ebef; }
#assignment-center .table-striped > tbody > tr:nth-of-type(odd) { background: #fff; }
#assignment-center .table > tbody > tr:hover { background: #f8fafb; }
#assignment-center .table a { color: #0066a1; }
#assignment-center .table a:hover { text-decoration: underline; }
#assignment-center a:focus-visible, #assignment-center button:focus-visible, #assignment-center input:focus-visible { outline: 2px solid #0066a1; outline-offset: 2px; }
@media (max-width: 767px) { #assignment-center .table > tbody > tr > td { padding: 8px 10px; } }
`;
