interface AttributeValue {
  before: string | null;
  applied: string;
}

interface StyleValue {
  value: string;
  priority: string;
}

/** Own cosmetic properties until their native elements stop being enhanced. */
export function createAttributeOwnership<T extends Element = HTMLElement>() {
  const previous = new Map<T, Map<string, AttributeValue>>();
  const styles = new Map<HTMLElement, Map<string, { before: StyleValue; applied: StyleValue; requested: StyleValue }>>();
  const restore = (element: T, attribute: string) => {
    const attributes = previous.get(element);
    const saved = attributes?.get(attribute);
    if (!attributes || !saved) return;
    if (element.getAttribute(attribute) === saved.applied) {
      if (saved.before === null) element.removeAttribute(attribute);
      else element.setAttribute(attribute, saved.before);
    }
    attributes.delete(attribute);
    if (!attributes.size) previous.delete(element);
  };
  const mark = (element: T, attribute: string, value: string) => {
    let attributes = previous.get(element);
    if (!attributes) { attributes = new Map(); previous.set(element, attributes); }
    const current = element.getAttribute(attribute);
    const saved = attributes.get(attribute);
    if (!saved || current !== saved.applied) attributes.set(attribute, { before: current, applied: value });
    else saved.applied = value;
    if (current !== value) element.setAttribute(attribute, value);
  };
  const retain = (keep: (element: T, attribute: string) => boolean) => {
    for (const [element, attributes] of previous) {
      for (const attribute of attributes.keys()) if (!keep(element, attribute)) restore(element, attribute);
    }
  };
  const restoreStyle = (element: HTMLElement, property: string) => {
    const properties = styles.get(element);
    const saved = properties?.get(property);
    if (!properties || !saved) return;
    if (element.style.getPropertyValue(property) === saved.applied.value && element.style.getPropertyPriority(property) === saved.applied.priority) {
      if (saved.before.value) element.style.setProperty(property, saved.before.value, saved.before.priority);
      else element.style.removeProperty(property);
    }
    properties.delete(property);
    if (!properties.size) styles.delete(element);
  };
  const style = (element: HTMLElement, property: string, value: string, priority = '') => {
    let properties = styles.get(element);
    if (!properties) { properties = new Map(); styles.set(element, properties); }
    const current = { value: element.style.getPropertyValue(property), priority: element.style.getPropertyPriority(property) };
    const saved = properties.get(property);
    const retained = saved && current.value === saved.applied.value && current.priority === saved.applied.priority;
    if (retained && saved.requested.value === value && saved.requested.priority === priority) return;
    if (current.value !== value || current.priority !== priority) element.style.setProperty(property, value, priority);
    properties.set(property, {
      before: retained ? saved.before : current,
      applied: { value: element.style.getPropertyValue(property), priority: element.style.getPropertyPriority(property) },
      requested: { value, priority },
    });
  };
  const clear = () => {
    retain(() => false);
    for (const [element, properties] of styles) for (const property of properties.keys()) restoreStyle(element, property);
  };
  return { mark, restore, retain, style, restoreStyle, clear };
}
