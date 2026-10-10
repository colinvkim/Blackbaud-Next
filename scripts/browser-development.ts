import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Browser as BrowserKind, Cache, computeExecutablePath, detectBrowserPlatform, getDownloadUrl, install } from '@puppeteer/browsers';
import puppeteer from 'puppeteer-core';
import type { Browser } from 'puppeteer-core';
import { PUPPETEER_REVISIONS } from 'puppeteer-core/internal/revisions.js';

export interface DevelopmentOptions {
  url: string;
  profile: string;
  executable?: string;
  headless: boolean;
  help: boolean;
}

export function developmentPaths(root: string) {
  const state = resolve(root, '.local/dev-browser');
  return {
    state,
    cache: resolve(state, 'browsers'),
    profile: resolve(state, 'profile'),
    extension: resolve(state, 'extension'),
    staging: resolve(state, 'staging'),
    previous: resolve(state, 'previous'),
  };
}

export function parseDevelopmentOptions(args: string[], root: string): DevelopmentOptions {
  const { values } = parseArgs({ args, options: {
    url: { type: 'string', default: 'https://polytechnic.myschoolapp.com' },
    profile: { type: 'string' },
    executable: { type: 'string' },
    headless: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  } });
  const url = new URL(values.url!);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('--url must be an HTTP(S) URL without embedded credentials.');
  }
  return {
    url: url.href,
    profile: resolve(root, values.profile ?? developmentPaths(root).profile),
    executable: values.executable ? resolve(root, values.executable) : undefined,
    headless: values.headless!,
    help: values.help!,
  };
}

/** Uses the browser version pinned by Puppeteer; downloads it only when absent. */
export async function ensureDevelopmentBrowser(
  cache: string,
  executable?: string,
  log: (message: string) => void = console.log,
): Promise<string> {
  if (executable) {
    await access(executable, constants.X_OK);
    return executable;
  }
  const options = { browser: BrowserKind.CHROME, buildId: PUPPETEER_REVISIONS.chrome, cacheDir: cache };
  const platform = detectBrowserPlatform();
  if (!platform) throw new Error('Chrome for Testing is unavailable for this operating system.');
  const browserCache = new Cache(cache);
  const installation = browserCache.installationDir(options.browser, platform, options.buildId);
  const complete = resolve(installation, '.blackbaud-next-complete');
  const cached = computeExecutablePath(options);
  try {
    await access(complete);
    await access(cached, constants.X_OK);
    return cached;
  } catch {
    log(`Downloading Chrome for Testing ${options.buildId} (first run only)...`);
  }
  // An interrupted download/extraction must not be mistaken for a usable installation.
  // Remove only this runner's pinned build and its archive, never the profile or other builds.
  await rm(installation, { recursive: true, force: true });
  const archive = basename(getDownloadUrl(options.browser, platform, options.buildId).pathname);
  await rm(resolve(browserCache.browserRoot(options.browser), `${options.buildId}-${archive}`), { force: true });
  const installed = await install({ ...options, downloadProgressCallback: 'default' });
  await writeFile(complete, options.buildId);
  return installed.executablePath;
}

export async function launchDevelopmentBrowser(options: DevelopmentOptions, executablePath: string): Promise<Browser> {
  await mkdir(options.profile, { recursive: true });
  return puppeteer.launch({
    executablePath,
    userDataDir: options.profile,
    headless: options.headless,
    pipe: true,
    enableExtensions: true,
    defaultViewport: null,
    // The runner owns shutdown, including a build that is still in flight.
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  });
}

/** Publishes a complete build so a compile error cannot replace working files. */
export async function publishDevelopmentBuild(staging: string, extension: string, previous: string): Promise<void> {
  await rm(previous, { recursive: true, force: true });
  let movedPrevious = false;
  try {
    await rename(extension, previous);
    movedPrevious = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  try {
    await rename(staging, extension);
  } catch (error) {
    if (movedPrevious) await rename(previous, extension);
    throw error;
  }
  await rm(previous, { recursive: true, force: true });
}

export async function buildDevelopmentExtension(root: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const paths = developmentPaths(root);
  await mkdir(paths.state, { recursive: true });
  await rm(paths.staging, { recursive: true, force: true });
  await new Promise<void>((resolveBuild, reject) => {
    const child = spawn(process.execPath, [resolve(root, 'scripts/build.ts'), '--out-dir', paths.staging], {
      cwd: root, signal, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const collect = (chunk: Buffer) => { output = (output + chunk.toString()).slice(-12_000); };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolveBuild();
      else reject(new Error(`Extension build failed.\n${output.trim()}`));
    });
  });
  signal.throwIfAborted();
  await publishDevelopmentBuild(paths.staging, paths.extension, paths.previous);
}

/** Authentication pages and unrelated tabs are deliberately outside the refresh scope. */
export function shouldRefreshDevelopmentPage(url: string, startUrl: string, extensionId: string): boolean {
  try {
    const page = new URL(url);
    return page.origin === new URL(startUrl).origin ||
      (page.protocol === 'chrome-extension:' && page.hostname === extensionId);
  } catch { return false; }
}

export async function reloadDevelopmentExtension(
  browser: Browser,
  extensionPath: string,
  startUrl: string,
  signal: AbortSignal,
  warn: (message: string) => void = console.warn,
): Promise<{ id: string; refreshed: number }> {
  signal.throwIfAborted();
  // Loading the same path reloads the unpacked extension without uninstalling it.
  const id = await browser.installExtension(extensionPath);
  signal.throwIfAborted();
  let refreshed = 0;
  for (const page of await browser.pages()) {
    if (signal.aborted) break;
    if (!shouldRefreshDevelopmentPage(page.url(), startUrl, id)) continue;
    try {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 15_000, signal });
      refreshed++;
    } catch {
      if (!signal.aborted) warn('A test tab could not finish refreshing; the extension is reloaded.');
    }
  }
  return { id, refreshed };
}
