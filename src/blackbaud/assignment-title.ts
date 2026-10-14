const richTitle = /^<(span|p|div|b|strong|em|i|u|s|font|small|sub|sup|mark|code)\b[^>]*>[\s\S]*<\/\1\s*>$/i;
const entity = /&(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);/i;
const incompleteEntity = /&(?!(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);)/gi;

export function assignmentTitle(value: unknown, page?: Document, limit = 300): string {
  if (typeof value !== 'string') return '';
  const input = value.slice(0, 200_000).trim();
  let title = input;
  if (richTitle.test(input)) {
    const source = (page ?? document).createElement('template');
    // Keep entities as text until markup is removed, then decode them once.
    source.innerHTML = input.replace(/&/g, '&amp;');
    const wrapper = source.content.firstElementChild;
    const wholeWrapper = wrapper && [...source.content.childNodes].every((node) =>
      node === wrapper || (node.nodeType === 3 && !node.textContent?.trim()),
    );
    if (wholeWrapper) {
      for (const element of source.content.querySelectorAll('script, style, iframe, object, embed, svg, math, template, noscript, form, input, button, select, textarea, img, video, audio')) element.remove();
      for (const element of source.content.querySelectorAll('br')) element.replaceWith(' ');
      for (const element of source.content.querySelectorAll('p, div')) {
        element.prepend(' ');
        element.append(' ');
      }
      title = source.content.textContent ?? '';
    }
  }
  if (entity.test(title)) {
    const source = (page ?? document).createElement('template');
    const escaped = title.replace(incompleteEntity, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    // Attribute parsing preserves unknown entity names instead of partially
    // decoding their legacy prefixes. This template is never attached.
    source.innerHTML = `<span data-title="${escaped}"></span>`;
    title = source.content.firstElementChild!.getAttribute('data-title') ?? '';
  }
  return title.replace(/\s+/g, ' ').trim().slice(0, limit);
}

export function assignmentElementTitle(element: HTMLElement, limit = 300): string {
  // Existing child markup has already been decoded by the native renderer.
  if (element.children.length) return element.textContent?.replace(/\s+/g, ' ').trim().slice(0, limit) ?? '';
  return assignmentTitle(element.textContent, element.ownerDocument, limit);
}
