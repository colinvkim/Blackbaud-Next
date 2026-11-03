export type DirectoryLayout = 'columns' | 'rows';

const layouts = new WeakMap<Document, DirectoryLayout>();

export function directoryLayout(page: Document): DirectoryLayout {
  return layouts.get(page) ?? 'columns';
}

export function rememberDirectoryLayout(page: Document, layout: DirectoryLayout): void {
  layouts.set(page, layout);
}
