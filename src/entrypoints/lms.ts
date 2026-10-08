import { startExtension } from '../runtime/start.ts';
import { loginFeature } from '../features/login.ts';
import { rosterToolsFeature } from '../features/roster-tools.ts';
import { avatarDownloadFeature } from '../features/avatar-download.ts';
import { faviconFeature } from '../features/favicon.ts';
import { oldAssignmentCenterFeature, assignmentRecoveryFeature } from '../features/assignment-center.ts';
import { pageAppearanceFeature, toolStylesFeature } from '../features/page-appearance.ts';
import { assignmentShortcutsFeature } from '../features/assignment-shortcuts.ts';
import { assignmentPreviewFeature } from '../features/assignment-preview.ts';
import { helpfulTabTitlesFeature, resourceSearchFeature } from '../features/navigation.ts';
import { classNavigationFeature } from '../features/class-navigation.ts';

function start() {
  void startExtension([
    toolStylesFeature, loginFeature, pageAppearanceFeature, faviconFeature,
    oldAssignmentCenterFeature, assignmentRecoveryFeature, rosterToolsFeature, avatarDownloadFeature,
    assignmentShortcutsFeature, assignmentPreviewFeature, helpfulTabTitlesFeature, resourceSearchFeature,
    classNavigationFeature,
  ]).catch((error) => console.warn('Blackbaud Next could not start.', error));
}
start();
window.addEventListener('pageshow', (event) => { if (event.persisted) start(); });
