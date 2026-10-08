import { ASSIGNMENT_PREVIEW_LINK_SELECTOR, assignmentInstructions, assignmentPreviewReturnFocus, assignmentPreviewTarget, fetchAssignmentPreview } from '../blackbaud/assignment-preview.ts';
import type { AssignmentPreviewTarget } from '../blackbaud/assignment-preview.ts';
import { isLmsPage } from '../blackbaud/routes.ts';
import { addStyle, createButton, isActionable, observeDom } from '../shared/dom.ts';
import type { Feature } from '../shared/types.ts';

const panelId = 'blackbaud-next-assignment-preview';
const styles = `
.bn-preview-button { margin-left: 10px; min-height: 28px; padding: 3px 9px; font-size: 12px; }
.bn-preview-panel { position: fixed; inset: 0 0 0 auto; z-index: 100000; box-sizing: border-box; width: min(460px, 100vw); padding: 24px; overflow: auto; border-left: 1px solid #d1dbe7; background: #fff; color: #22354e; box-shadow: -8px 0 32px #18314e24; font: 14px/1.55 system-ui, -apple-system, sans-serif; }
.bn-preview-panel * { box-sizing: border-box; }
.bn-preview-panel h2 { margin: 16px 0 10px; font-size: 22px; line-height: 1.35; overflow-wrap: anywhere; }
.bn-preview-actions { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 10px; }
.bn-preview-meta { color: #526174; margin: 0 0 16px; }
.bn-preview-instructions { overflow-wrap: anywhere; }
.bn-preview-instructions :is(pre, table) { max-width: 100%; overflow: auto; }
.bn-preview-instructions a, .bn-preview-attachments a { color: #245d9e; text-decoration: underline; }
.bn-preview-attachments { margin-top: 24px; }
.bn-preview-attachments h3 { font-size: 16px; }
.bn-preview-attachments li { margin: 8px 0; }
.bn-preview-note { margin-top: 24px; color: #526174; font-size: 12px; }
`;

export const assignmentPreviewFeature: Feature = {
  id: 'assignment-previews',
  enabled: (settings) => settings.assignmentPreviews,
  matches: isLmsPage,
  mount: ({ url, signal }) => {
    if (signal.aborted) return;
    const removeStyle = addStyle('assignment-previews', styles);
    const controls = new Map<HTMLAnchorElement, { button: HTMLButtonElement; dispose: () => void }>();
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
      const closeButton = createButton('Close preview');
      closeButton.addEventListener('click', () => close());
      const full = document.createElement('a');
      full.className = 'bn-button';
      full.href = target.detailsUrl;
      full.textContent = 'Open full assignment';
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
          const preview = await fetchAssignmentPreview(target, currentRequest.signal);
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
          const retry = createButton('Retry preview');
          retry.addEventListener('click', () => { closeButton.focus(); void load(); });
          content.append(retry);
        }
      };
      void load();
    };

    const stop = observeDom(() => {
      for (const [link, control] of controls) {
        if (!link.isConnected || !link.matches(ASSIGNMENT_PREVIEW_LINK_SELECTOR) || !assignmentPreviewTarget(link, url.href)) {
          control.dispose();
          controls.delete(link);
        }
      }
      for (const link of document.querySelectorAll<HTMLAnchorElement>(ASSIGNMENT_PREVIEW_LINK_SELECTOR)) {
        const target = assignmentPreviewTarget(link, url.href);
        if (!target) continue;
        let control = controls.get(link);
        if (!control) {
          const button = createButton('Preview');
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
          control = { button, dispose: () => { button.removeEventListener('click', click); button.remove(); } };
          controls.set(link, control);
        }
        const label = `Preview ${target.title}`;
        if (control.button.getAttribute('aria-label') !== label) control.button.setAttribute('aria-label', label);
        control.button.setAttribute('aria-expanded', String(panel !== null && openedAssignmentId === target.assignmentIndexId));
        if (link.nextElementSibling !== control.button) link.insertAdjacentElement('afterend', control.button);
      }
    }, signal);
    const cleanup = () => {
      if (disposed) return;
      disposed = true;
      stop();
      close(false);
      for (const control of controls.values()) control.dispose();
      controls.clear();
      removeStyle();
      signal.removeEventListener('abort', cleanup);
    };
    signal.addEventListener('abort', cleanup, { once: true });
    return cleanup;
  },
};
