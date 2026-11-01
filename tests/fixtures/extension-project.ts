import { cp, mkdir, symlink } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function copyExtensionProject(root: string, fixture: string, scripts: readonly string[] = ['build.ts']): Promise<void> {
  for (const name of ['src', 'assets', 'extension']) await cp(resolve(root, name), resolve(fixture, name), { recursive: true });
  await mkdir(resolve(fixture, 'scripts'));
  for (const name of scripts) await cp(resolve(root, 'scripts', name), resolve(fixture, 'scripts', name));
  await symlink(resolve(root, 'node_modules'), resolve(fixture, 'node_modules'), 'dir');
}
