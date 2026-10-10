import { installDirectoryPageBridge } from '../blackbaud/directory-page.ts';
import { installIndependentDirectoryPageBridge } from '../blackbaud/directory-independent-page.ts';

installDirectoryPageBridge(window);
installIndependentDirectoryPageBridge(window);
