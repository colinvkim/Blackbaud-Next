import { startExtension } from '../runtime/start.ts';
import { loginFeature } from '../features/login.ts';
import { rosterToolsFeature } from '../features/roster-tools.ts';
import { avatarDownloadFeature } from '../features/avatar-download.ts';
import { faviconFeature } from '../features/favicon.ts';
import { oldAssignmentCenterFeature, assignmentRecoveryFeature, assignmentBreadcrumbFeature } from '../features/assignment-center.ts';
import { assignmentShortcutsFeature } from '../features/assignment-shortcuts.ts';
import { assignmentPreviewFeature } from '../features/assignment-preview.ts';
import { assignmentCompletionFeature } from '../features/assignment-completion.ts';
import { helpfulTabTitlesFeature, resourceSearchFeature } from '../features/navigation.ts';
import { classNavigationFeature } from '../features/class-navigation.ts';
import { assignmentWarmupFeature } from '../features/assignment-warmup.ts';
import { startOnActivation } from '../runtime/activation.ts';
import { enhancedDirectoryFeature } from '../features/directory.ts';
import { directoryLoadingFeature } from '../features/directory-loading.ts';

function start() {
  void startExtension([
    loginFeature, faviconFeature,
    oldAssignmentCenterFeature, assignmentRecoveryFeature, assignmentBreadcrumbFeature, rosterToolsFeature, avatarDownloadFeature,
    assignmentShortcutsFeature, assignmentPreviewFeature, assignmentCompletionFeature, helpfulTabTitlesFeature, resourceSearchFeature,
    classNavigationFeature,
    assignmentWarmupFeature,
    directoryLoadingFeature,
    enhancedDirectoryFeature,
  ]).catch((error) => console.warn('Blackbaud Next could not start.', error));
}
startOnActivation(start);
