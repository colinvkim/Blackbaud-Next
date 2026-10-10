import { startExtension } from '../runtime/start.ts';
import { loginFeature } from '../features/login.ts';
import { startOnActivation } from '../runtime/activation.ts';

function start() { void startExtension([loginFeature]).catch((error) => console.warn('Blackbaud Next could not start.', error)); }
startOnActivation(start);
