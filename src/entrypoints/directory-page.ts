import { installDirectoryPageBridge } from '../blackbaud/directory-page.ts';
import { installIndependentDirectoryPageBridge } from '../blackbaud/directory-independent-page.ts';
import { installAssignmentStatusPageBridge } from '../blackbaud/assignment-status-page.ts';

installDirectoryPageBridge(window);
installIndependentDirectoryPageBridge(window);
installAssignmentStatusPageBridge(window);
