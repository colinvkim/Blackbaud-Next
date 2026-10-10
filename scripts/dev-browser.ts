import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser } from 'puppeteer-core';
import { BuildQueue, watchProjectSources } from './browser-build.ts';
import {
  buildDevelopmentExtension, developmentPaths, ensureDevelopmentBrowser,
  launchDevelopmentBrowser, parseDevelopmentOptions, reloadDevelopmentExtension,
} from './browser-development.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const options = parseDevelopmentOptions(process.argv.slice(2), root);
if (options.help) {
  console.log(`Usage: pnpm dev:browser [options]

  --url <url>         School/test URL (default: Polytechnic)
  --profile <path>    Dedicated test profile (default: .local/dev-browser/profile)
  --executable <path> Use an existing compatible Chrome for Testing binary
  --headless         Run without a visible window

Source edits rebuild all bundles, reload the extension, and refresh school tabs.
Sign in manually in the test browser. Press Ctrl+C to stop.`);
} else {
  const paths = developmentPaths(root);
  let browser: Browser | undefined;
  let stopWatching: (() => void) | undefined;
  let stopping: Promise<void> | undefined;
  let initial = true;
  const queue = new BuildQueue({
    async build(signal) {
      console.log('Building extension...');
      await buildDevelopmentExtension(root, signal);
    },
    async onSuccess(signal) {
      if (!browser) {
        const executable = await ensureDevelopmentBrowser(paths.cache, options.executable);
        signal.throwIfAborted();
        browser = await launchDevelopmentBrowser(options, executable);
        if (signal.aborted) {
          await browser.close();
          signal.throwIfAborted();
        }
        browser.once('disconnected', () => { void stop(); });
      }
      const result = await reloadDevelopmentExtension(browser, paths.extension, options.url, signal);
      if (initial) {
        initial = false;
        const pages = await browser.pages();
        const page = pages.find((candidate) => candidate.url() === 'about:blank') ?? await browser.newPage();
        try { await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: 30_000, signal }); }
        catch { if (!signal.aborted) console.warn('Test browser is open; navigate to Blackbaud manually if needed.'); }
        console.log(`Development browser ready. Extension: ${result.id}`);
        console.log('Sign in in this browser; future runs retain this dedicated profile.');
        console.log('Watching src/, extension/, assets/, and scripts/build.ts. Ctrl+C stops.');
      } else {
        console.log(`Extension reloaded; refreshed ${result.refreshed} test tab(s).`);
      }
    },
    onError(error) {
      console.error(error instanceof Error ? error.message : String(error));
      console.error('Waiting for the next edit to retry.');
    },
  });

  function stop(): Promise<void> {
    if (stopping) return stopping;
    stopWatching?.();
    stopping = (async () => {
      const disposed = queue.dispose();
      await browser?.close();
      await disposed;
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
    })();
    return stopping;
  }
  function onSignal() {
    // Provisioning may be downloading when interrupted; do not trap Ctrl+C indefinitely.
    const forceExit = setTimeout(() => { browser?.process()?.kill(); process.exit(130); }, 5_000);
    forceExit.unref();
    void stop().finally(() => clearTimeout(forceExit));
  }
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  try {
    stopWatching = watchProjectSources(root, () => queue.requestBuild(), (error) => {
      console.error('Source watching failed:', error);
      process.exitCode = 1;
      void stop();
    });
    await queue.buildNow();
  } catch (error) {
    if (!stopping) {
      console.error('Could not start dev:browser:', error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    await stop();
  }
}
