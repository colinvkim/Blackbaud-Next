/** Own cosmetic attributes until their native elements stop being enhanced. */
export function createAttributeOwnership<T extends Element = HTMLElement>() {
  const previous = new Map<T, Map<string, string | null>>();
  const restore = (element: T, attribute: string) => {
    const attributes = previous.get(element);
    if (!attributes?.has(attribute)) return;
    const value = attributes.get(attribute)!;
    if (value === null) element.removeAttribute(attribute);
    else element.setAttribute(attribute, value);
    attributes.delete(attribute);
    if (!attributes.size) previous.delete(element);
  };
  const mark = (element: T, attribute: string, value: string) => {
    let attributes = previous.get(element);
    if (!attributes) { attributes = new Map(); previous.set(element, attributes); }
    if (!attributes.has(attribute)) attributes.set(attribute, element.getAttribute(attribute));
    if (element.getAttribute(attribute) !== value) element.setAttribute(attribute, value);
  };
  const retain = (keep: (element: T, attribute: string) => boolean) => {
    for (const [element, attributes] of previous) {
      for (const attribute of [...attributes.keys()]) if (!keep(element, attribute)) restore(element, attribute);
    }
  };
  return { mark, restore, retain, clear: () => retain(() => false) };
}
