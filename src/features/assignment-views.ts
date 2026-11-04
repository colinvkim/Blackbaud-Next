import { ASSIGNMENT_VIEW_SELECTOR, assignmentViewControls, classicAssignmentContent, isClassicAssignmentCenter, isStudentAssignmentCenter } from '../blackbaud/assignment-views.ts';
import { isAssignmentDetail } from '../blackbaud/assignment-navigation.ts';
import { ASSIGNMENT_LOADING_MASK_SELECTOR, isAssignmentLoadingVisible } from '../blackbaud/assignment-loading.ts';
import { legacyAssignmentCenterUrl } from '../blackbaud/routes.ts';
import { createAttributeOwnership } from '../shared/attribute-ownership.ts';
import { getAssignmentCenterView, rememberAssignmentCenterView, type AssignmentCenterView } from '../shared/assignment-view-preference.ts';
import { markOwned, observeDom, observeElementContext, watchAddedElements } from '../shared/dom.ts';
import { createIcon } from '../shared/icons.ts';
import { createScope } from '../shared/scope.ts';
import type { Feature } from '../shared/types.ts';
import { ASSIGNMENT_VIEWS_STYLES, CLASSIC_FRAME_LAYOUT, CLASSIC_FRAME_STYLES } from './assignment-views-styles.ts';

export const assignmentViewsFeature: Feature = {
  id: 'assignment-views',
  settingsKeys: [],
  enabled: settings => settings.mode === 'full',
  matches: isStudentAssignmentCenter,
  mount: ({ url, signal }) => {
    const scope = createScope(signal);
    let preference: AssignmentCenterView | null = null;
    let selected = false;
    const restorers = new Set<() => void>();
    const restoreViews = () => { for (const restore of restorers) restore(); };
    const remember = (view: AssignmentCenterView) => {
      if (scope.signal.aborted || window.location.href !== url.href) return;
      selected = true;
      preference = view;
      void rememberAssignmentCenterView(view).catch(error => {
        if (!scope.signal.aborted) console.warn('Blackbaud Next could not remember the assignment view.', error);
      });
    };
    void getAssignmentCenterView().then(view => {
      if (scope.signal.aborted || selected || window.location.href !== url.href) return;
      preference = view;
      restoreViews();
    }).catch(error => {
      if (!scope.signal.aborted) console.warn('Blackbaud Next could not read the assignment view preference.', error);
    });
    scope.style('blackbaud-next-assignment-views', ASSIGNMENT_VIEWS_STYLES);
    scope.add(watchAddedElements<HTMLElement>(ASSIGNMENT_LOADING_MASK_SELECTOR, mask => {
      const stop = observeElementContext(mask, restoreViews);
      return () => { stop(); restoreViews(); };
    }, scope.signal));
    scope.add(watchAddedElements<HTMLElement>(ASSIGNMENT_VIEW_SELECTOR, group => {
      const discovery = createScope(scope.signal);
      let current: ReturnType<typeof assignmentViewControls> = null;
      let release: (() => void) | undefined;
      const mountControls = (controls: NonNullable<ReturnType<typeof assignmentViewControls>>) => {
        const visit = createScope(discovery.signal);
        const ownership = createAttributeOwnership();
        const { root, fieldset, icons, inputs } = controls;
        const label = markOwned(document.createElement('label'));
        label.className = 'bn-classic-view-label';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'viewMode';
        radio.value = 'classic';
        radio.className = 'bn-classic-view-input';
        radio.id = 'blackbaud-next-classic-view';
        radio.setAttribute('aria-label', 'Classic assignment center');
        const caption = document.createElement('span');
        caption.append(createIcon('rows-3'), 'Classic');
        label.append(radio, caption);
        icons.append(label);
        ownership.mark(group, 'data-bn-view-switch', '');
        ownership.mark(fieldset, 'aria-owns', `${fieldset.getAttribute('aria-owns') ?? ''} ${radio.id}`.trim());
        const panel = markOwned(document.createElement('section'));
        panel.className = 'bn-classic-panel';
        panel.setAttribute('aria-label', 'Classic assignment center');
        panel.hidden = true;
        root.append(panel);
        let active = false;
        let restoring = false;
        let restored = false;
        let previous = inputs.find(input => input.checked) ?? inputs[0]!;
        let frameScope: ReturnType<typeof createScope> | undefined;

        const concealModern = () => {
          const hidden = new Set<HTMLElement>();
          // Hide sibling branches along the path to the switch, leaving native
          // overlays outside this component and the view controls themselves alone.
          let branch: Element = group;
          while (branch !== root && branch.parentElement && root.contains(branch.parentElement)) {
            for (const sibling of branch.parentElement.children) {
              if (sibling !== branch && sibling !== panel && sibling instanceof HTMLElement) hidden.add(sibling);
            }
            branch = branch.parentElement;
          }
          ownership.retain((element, attribute) => attribute !== 'data-bn-classic-hidden' || hidden.has(element as HTMLElement));
          for (const element of hidden) ownership.mark(element, 'data-bn-classic-hidden', '');
        };
        const close = () => {
          if (!active) return;
          active = false;
          frameScope?.dispose();
          frameScope = undefined;
          panel.replaceChildren();
          panel.hidden = true;
          radio.checked = false;
          if (!inputs.some(input => input.checked)) previous.checked = true;
          ownership.retain((_element, attribute) => attribute !== 'data-bn-classic-hidden');
        };
        const open = () => {
          if (visit.signal.aborted || !assignmentViewControls(group)) return;
          if (active) {
            for (const input of inputs) input.checked = false;
            radio.checked = true;
            return;
          }
          previous = inputs.find(input => input.checked) ?? previous;
          active = true;
          for (const input of inputs) input.checked = false;
          radio.checked = true;
          panel.hidden = false;
          concealModern();
          const loading = document.createElement('div');
          loading.className = 'bn-classic-loading';
          loading.setAttribute('role', 'status');
          loading.setAttribute('aria-label', 'Loading classic assignment center');
          for (let i = 0; i < 5; i++) loading.append(document.createElement('span'));
          const frame = document.createElement('iframe');
          frame.className = 'bn-classic-frame';
          frame.title = 'Classic assignment center';
          frame.hidden = true;
          panel.replaceChildren(loading, frame);
          const frameVisit = createScope(visit.signal);
          frameScope = frameVisit;
          const destination = legacyAssignmentCenterUrl(url);
          let stopDocument: (() => void) | undefined;
          let timeout: ReturnType<typeof setTimeout> | undefined;
          const resize = () => { frame.style.height = `${Math.max(360, window.innerHeight - Math.max(0, frame.getBoundingClientRect().top) - 24)}px`; };
          const fail = () => {
            if (frameVisit.signal.aborted) return;
            frameVisit.dispose();
            const error = document.createElement('div');
            error.className = 'bn-classic-error';
            const message = document.createElement('p');
            message.textContent = 'The classic view couldn’t load here.';
            const link = document.createElement('a');
            link.href = destination;
            link.textContent = 'Open Classic Assignment Center';
            error.append(message, link);
            panel.replaceChildren(error);
          };
          const inspect = () => {
            stopDocument?.();
            stopDocument = undefined;
            clearTimeout(timeout);
            timeout = setTimeout(fail, 20_000);
            frame.hidden = true;
            panel.prepend(loading);
            let page: Document | null;
            try {
              if (!frame.contentWindow || !isClassicAssignmentCenter(new URL(frame.contentWindow.location.href))) { fail(); return; }
              page = frame.contentDocument;
            } catch { fail(); return; }
            if (!page) { fail(); return; }
            const current = page;
            let styled = false;
            let style: HTMLStyleElement | undefined;
            let observed: Element | undefined;
            let stopContext: (() => void) | undefined;
            const updateAppearance = () => {
              if (style) style.textContent = document.documentElement.hasAttribute('data-blackbaud-next-appearance') ? CLASSIC_FRAME_STYLES : CLASSIC_FRAME_LAYOUT;
              if (styled) resize();
            };
            const update = () => {
              if (frameVisit.signal.aborted) return;
              try { if (!isClassicAssignmentCenter(new URL(frame.contentWindow!.location.href))) { fail(); return; } } catch { fail(); return; }
              const container = current.querySelector('#site-main') ?? current.body ?? current.documentElement;
              if (observed !== container) {
                observer.disconnect();
                stopContext?.();
                observed = container;
                observer.observe(container, { childList: true, subtree: true });
                stopContext = observeElementContext(container, update);
              }
              const content = classicAssignmentContent(current);
              if (!content) {
                if (styled) {
                  styled = false;
                  style?.remove();
                  frame.hidden = true;
                  panel.prepend(loading);
                  timeout = setTimeout(fail, 20_000);
                }
                return;
              }
              if (styled) return;
              styled = true;
              clearTimeout(timeout);
              style = markOwned(current.createElement('style'));
              updateAppearance();
              current.head.append(style);
              loading.remove();
              frame.hidden = false;
              resize();
            };
            const observer = new MutationObserver(update);
            const appearanceObserver = new MutationObserver(updateAppearance);
            appearanceObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-blackbaud-next-appearance'] });
            const navigate = (event: MouseEvent) => {
              if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[href]');
              if (!anchor || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return;
              const target = new URL(anchor.href, current.URL);
              if (target.origin !== url.origin || (!anchor.matches('.assignment-detail-link') && !isAssignmentDetail(target))) return;
              event.preventDefault();
              event.stopImmediatePropagation();
              window.location.assign(target.href);
            };
            current.addEventListener('click', navigate, true);
            stopDocument = () => { observer.disconnect(); stopContext?.(); appearanceObserver.disconnect(); current.removeEventListener('click', navigate, true); style?.remove(); };
            update();
          };
          frameVisit.listen(frame, 'load', inspect);
          frameVisit.listen(window, 'resize', resize);
          frameVisit.add(() => { clearTimeout(timeout); stopDocument?.(); frame.remove(); });
          timeout = setTimeout(fail, 20_000);
          frame.src = destination;
        };
        visit.listen(radio, 'change', () => { if (radio.checked) { remember('classic'); open(); } });
        for (const input of inputs) visit.listen(input, 'click', () => {
          previous = input;
          close();
          if (!restoring) remember(input.value === '1' ? 'calendar' : 'list');
        });
        const restore = () => {
          if (visit.signal.aborted || restored || !preference || !inputs.some(input => input.checked) ||
            [...document.querySelectorAll(ASSIGNMENT_LOADING_MASK_SELECTOR)].some(isAssignmentLoadingVisible)) return;
          if (preference === 'classic') { restored = true; open(); return; }
          const input = inputs.find(input => input.value === (preference === 'calendar' ? '1' : '0'))!;
          if (input.disabled) return;
          restored = true;
          if (!input.checked) {
            restoring = true;
            try { input.click(); } finally { restoring = false; }
          }
        };
        restorers.add(restore);
        visit.add(() => restorers.delete(restore));
        visit.add(observeDom(() => { restore(); if (active) concealModern(); }, visit.signal, root));
        visit.add(() => { close(); label.remove(); panel.remove(); ownership.clear(); });
        return visit.dispose;
      };
      const updateControls = () => {
        const next = assignmentViewControls(group);
        if (next && current && next.root === current.root && next.icons === current.icons && next.fieldset === current.fieldset &&
          next.inputs.every((input, index) => input === current!.inputs[index]) && group.querySelector('.bn-classic-view-label')) return;
        release?.();
        current = next;
        release = next ? mountControls(next) : undefined;
      };
      const observer = new MutationObserver(updateControls);
      observer.observe(group, { childList: true, subtree: true, attributes: true, attributeFilter: ['name', 'type', 'value', 'role', 'class', 'id'] });
      discovery.add(() => observer.disconnect());
      discovery.add(observeElementContext(group, change => { if (change.moved || change.ancestors) updateControls(); }));
      updateControls();
      discovery.add(() => release?.());
      return discovery.dispose;
    }, scope.signal, document, ['name']));
    return scope.dispose;
  },
};
