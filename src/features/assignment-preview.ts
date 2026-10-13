import { ASSIGNMENT_PREVIEW_LINK_SELECTOR, ASSIGNMENT_PREVIEW_ROOT_SELECTOR, assignmentInstructions, assignmentPreviewReturnFocus, assignmentPreviewTarget, createAssignmentPreviewReader } from '../blackbaud/assignment-preview.ts';
import type { AssignmentPreviewTarget } from '../blackbaud/assignment-preview.ts';
import { isLmsPage } from '../blackbaud/routes.ts';
import { addStyle, createButton, isActionable, observeDom, watchAddedElements } from '../shared/dom.ts';
import { createIcon } from '../shared/icons.ts';
import type { Feature } from '../shared/types.ts';

const panelId = 'blackbaud-next-assignment-preview';
const styles = `
.bn-preview-button { margin-left: 8px; min-height: 28px; padding: 4px 8px; vertical-align: middle; font-size: 12px; }
.bn-preview-panel { position: fixed; inset: 0 0 0 auto; z-index: 100000; box-sizing: border-box; width: min(460px, 100vw); padding: 24px; overflow: auto; overscroll-behavior: contain; scroll-padding-block: 20px; border-left: 1px solid var(--bn-border, #dde3e8); background: var(--bn-surface, #fff); color: var(--bn-text, #222a35); box-shadow: -8px 0 32px #222a3514; font: 15px/1.6 var(--bn-font, "Blackbaud Sans", "Helvetica Neue", Arial, sans-serif); }
.bn-preview-panel * { box-sizing: border-box; }
.bn-preview-panel > h2 { margin: 16px 0 8px; color: var(--bn-text, #222a35); font-size: 24px; font-weight: 600; line-height: 1.3; overflow-wrap: anywhere; }
.bn-preview-panel :is(a, button, pre, table):focus-visible { outline: 2px solid var(--bn-accent, #0066a1); outline-offset: 3px; }
.bn-preview-actions { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px; padding-bottom: 16px; border-bottom: 1px solid var(--bn-border, #dde3e8); }
.bn-preview-panel .bn-button { max-width: 100%; white-space: normal; }
.bn-preview-actions > a.bn-button { background: var(--bn-accent, #0066a1); border-color: var(--bn-accent, #0066a1); color: #fff; }
.bn-preview-actions > a.bn-button:hover { background: var(--bn-accent-hover, #004d7a); border-color: var(--bn-accent-hover, #004d7a); color: #fff; }
.bn-preview-meta { color: var(--bn-muted, #657080); margin: 0 0 16px; font-size: 13px; overflow-wrap: anywhere; }
.bn-preview-instructions { overflow-wrap: anywhere; }
.bn-preview-instructions :is(p, ul, ol, blockquote, pre, table) { margin: 0 0 12px; }
.bn-preview-instructions :is(ul, ol) { padding-left: 20px; }
.bn-preview-instructions blockquote { padding: 8px 12px; }
.bn-preview-instructions :is(pre, table) { max-width: 100%; overflow: auto; }
.bn-preview-instructions table { display: block; width: max-content; }
.bn-preview-instructions :is(h1, h2, h3, h4, h5, h6) { margin: 16px 0 8px; color: var(--bn-text, #222a35); font: 600 16px/1.4 var(--bn-font, "Blackbaud Sans", "Helvetica Neue", Arial, sans-serif); }
.bn-preview-instructions :is(h1, h2) { font-size: 18px; }
.bn-preview-instructions > :first-child { margin-top: 0; }
.bn-preview-instructions > :last-child { margin-bottom: 0; }
.bn-preview-instructions a, .bn-preview-attachments a { color: var(--bn-accent, #0066a1); text-decoration: underline; }
.bn-preview-instructions a:hover, .bn-preview-attachments a:hover { color: var(--bn-accent-hover, #004d7a); }
.bn-preview-attachments { margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--bn-border, #dde3e8); }
.bn-preview-attachments h3 { margin: 0 0 12px; font-size: 16px; font-weight: 600; }
.bn-preview-attachments ul { margin: 0; padding-left: 20px; }
.bn-preview-attachments li { margin: 0; overflow-wrap: anywhere; }
.bn-preview-attachments li + li { margin-top: 8px; }
.bn-preview-note { margin: 24px 0 0; padding-top: 16px; border-top: 1px solid var(--bn-border, #dde3e8); color: var(--bn-muted, #657080); font-size: 12px; }
@media (max-width: 480px) { .bn-preview-panel { padding: 16px; } .bn-preview-panel > h2 { font-size: 22px; } }
@media (max-width: 480px), (pointer: coarse) { .bn-preview-button, .bn-preview-panel .bn-button { min-height: 44px; } }
`;

export const assignmentPreviewFeature: Feature = {
  id: 'assignment-previews',
  settingsKeys: [],
  enabled: (settings) => settings.assignmentPreviews,
  matches: isLmsPage,
  mount: ({ url, signal }) => {
    if (signal.aborted) return;
    const removeStyle = addStyle('assignment-previews', styles);
    const reader = createAssignmentPreviewReader();
    const controls = new Map<HTMLAnchorElement, { root: HTMLElement; button: HTMLButtonElement; dispose: () => void }>();
    let panel: HTMLDivElement | null = null;
    let opener: HTMLButtonElement | null = null;
    let openedAssignmentId: string | null = null;
    let request: AbortController | null = null;
    let disposed = false;

    const close = (restoreFocus = true) => {
      request?.abort();
      request = null;
      panel?.remove();
      panel = null;
      const previous = opener;
      const previousId = openedAssignmentId;
      opener = null;
      openedAssignmentId = null;
      previous?.setAttribute('aria-expanded', 'false');
      for (const control of controls.values()) control.button.setAttribute('aria-expanded', 'false');
      if (!restoreFocus) return;
      const replacement = previousId ? [...controls].find(([link, control]) =>
        assignmentPreviewTarget(link, url.href)?.assignmentIndexId === previousId && isActionable(control.button))?.[1].button : null;
      const focusTarget = previous && isActionable(previous) ? previous : replacement ?? assignmentPreviewReturnFocus(document);
      focusTarget?.focus();
    };

    const open = (target: AssignmentPreviewTarget, button: HTMLButtonElement) => {
      if (disposed || signal.aborted) return;
      close(false);
      opener = button;
      openedAssignmentId = target.assignmentIndexId;
      button.setAttribute('aria-expanded', 'true');
      const currentPanel = document.createElement('div');
      panel = currentPanel;
      currentPanel.id = panelId;
      currentPanel.className = 'bn-preview-panel';
      currentPanel.setAttribute('role', 'dialog');
      currentPanel.setAttribute('aria-label', 'Assignment preview');
      currentPanel.setAttribute('aria-labelledby', `${panelId}-title`);
      const actions = document.createElement('div');
      actions.className = 'bn-preview-actions';
      const closeButton = createButton('Close preview', 'x');
      closeButton.addEventListener('click', () => close());
      const full = document.createElement('a');
      full.className = 'bn-button';
      full.href = target.detailsUrl;
      full.textContent = 'Open full assignment';
      full.prepend(createIcon('external-link'));
      actions.append(closeButton, full);
      const title = document.createElement('h2');
      title.id = `${panelId}-title`;
      title.textContent = target.title;
      const content = document.createElement('div');
      const note = document.createElement('p');
      note.className = 'bn-preview-note';
      note.textContent = 'Open the full assignment for submissions and any additional content.';
      currentPanel.append(actions, title, content, note);
      currentPanel.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        close();
      });
      (document.body ?? document.documentElement).append(currentPanel);
      closeButton.focus();

      const load = async () => {
        if (disposed || signal.aborted || panel !== currentPanel || window.location.href !== url.href) return;
        request?.abort();
        const currentRequest = new AbortController();
        request = currentRequest;
        const status = document.createElement('p');
        status.setAttribute('role', 'status');
        status.textContent = 'Loading preview…';
        content.replaceChildren(status);
        const isCurrent = () => !disposed && !signal.aborted && !currentRequest.signal.aborted &&
          panel === currentPanel && request === currentRequest && window.location.href === url.href;
        try {
          const preview = await reader.read(target, currentRequest.signal);
          if (!isCurrent()) return;
          title.textContent = preview.title;
          const metadata = document.createElement('p');
          metadata.className = 'bn-preview-meta';
          metadata.textContent = [preview.course, preview.due ? `Due ${preview.due}` : ''].filter(Boolean).join(' · ');
          const instructions = document.createElement('div');
          instructions.className = 'bn-preview-instructions';
          instructions.append(assignmentInstructions(preview.instructions, target.detailsUrl));
          if (!instructions.textContent?.trim()) instructions.textContent = 'No text instructions were provided. Check the full assignment for embedded content.';
          content.replaceChildren(metadata, instructions);
          if (preview.attachments.length) {
            const attachments = document.createElement('section');
            attachments.className = 'bn-preview-attachments';
            const heading = document.createElement('h3');
            heading.textContent = 'Links and attachments';
            const list = document.createElement('ul');
            for (const attachment of preview.attachments) {
              const item = document.createElement('li');
              const link = document.createElement('a');
              link.href = attachment.url;
              link.textContent = attachment.name;
              link.target = '_blank';
              link.rel = 'noopener noreferrer';
              item.append(link);
              list.append(item);
            }
            attachments.append(heading, list);
            content.append(attachments);
          }
        } catch {
          if (!isCurrent()) return;
          status.textContent = 'The preview could not be loaded. You can retry or open the full assignment.';
          const retry = createButton('Retry preview', 'refresh');
          retry.addEventListener('click', () => { closeButton.focus(); void load(); });
          content.append(retry);
        }
      };
      void load();
    };

    const stop = watchAddedElements<HTMLElement>(ASSIGNMENT_PREVIEW_ROOT_SELECTOR, (root) => {
      const update = () => {
        if (disposed || signal.aborted || !root.isConnected) return;
        for (const [link, control] of controls) {
          if (control.root === root && (!root.contains(link) || !link.matches(ASSIGNMENT_PREVIEW_LINK_SELECTOR) || !assignmentPreviewTarget(link, url.href))) {
            control.dispose();
            controls.delete(link);
          }
        }
        for (const link of root.querySelectorAll<HTMLAnchorElement>(ASSIGNMENT_PREVIEW_LINK_SELECTOR)) {
          const target = assignmentPreviewTarget(link, url.href);
          if (!target) continue;
          let control = controls.get(link);
          if (!control) {
            const button = createButton('Preview', 'eye');
            button.classList.add('bn-preview-button');
            button.dataset.blackbaudNextPreview = 'true';
            button.setAttribute('aria-controls', panelId);
            button.setAttribute('aria-haspopup', 'dialog');
            button.setAttribute('aria-expanded', 'false');
            const click = (event: MouseEvent) => {
              event.preventDefault();
              event.stopPropagation();
              const currentTarget = assignmentPreviewTarget(link, url.href);
              if (currentTarget) open(currentTarget, button);
            };
            button.addEventListener('click', click);
            control = { root, button, dispose: () => { button.removeEventListener('click', click); button.remove(); } };
            controls.set(link, control);
          }
          control.root = root;
          const label = `Preview ${target.title}`;
          if (control.button.getAttribute('aria-label') !== label) control.button.setAttribute('aria-label', label);
          control.button.setAttribute('aria-expanded', String(panel !== null && openedAssignmentId === target.assignmentIndexId));
          if (link.nextElementSibling !== control.button) link.insertAdjacentElement('afterend', control.button);
        }
      };
      const textObserver = new MutationObserver(update);
      textObserver.observe(root, { subtree: true, characterData: true });
      const stopUpdates = observeDom(update, signal, root);
      return () => {
        stopUpdates();
        textObserver.disconnect();
        for (const [link, control] of controls) {
          if (control.root !== root) continue;
          control.dispose();
          controls.delete(link);
        }
      };
    }, signal);
    const cleanup = () => {
      if (disposed) return;
      disposed = true;
      stop();
      close(false);
      reader.clear();
      for (const control of controls.values()) control.dispose();
      controls.clear();
      removeStyle();
      signal.removeEventListener('abort', cleanup);
    };
    signal.addEventListener('abort', cleanup, { once: true });
    return cleanup;
  },
};
