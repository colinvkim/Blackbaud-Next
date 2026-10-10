import { startOnActivation } from '../runtime/activation.ts';
import { startAppearance } from '../runtime/early-appearance.ts';

startOnActivation(() => {
  void startAppearance().catch((error) => console.warn('Blackbaud Next could not start appearance.', error));
});
