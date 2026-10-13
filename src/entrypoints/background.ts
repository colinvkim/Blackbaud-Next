import { installCoordinator } from '../background/coordinator.ts';
import { extensionApi } from '../shared/extension.ts';

installCoordinator(extensionApi());
