import { startExtension } from '../runtime/start.ts';
import { loginFeature } from '../features/login.ts';

function start() { void startExtension([loginFeature]).catch((error) => console.warn('Blackbaud Next could not start.', error)); }
start();
window.addEventListener('pageshow', (event) => { if (event.persisted) start(); });
