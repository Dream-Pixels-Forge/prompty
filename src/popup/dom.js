/**
 * Tiny DOM builder. Text is always set via text nodes / textContent — never
 * innerHTML — so prompt and site content can't inject markup (SECURITY.md).
 */

/**
 * @typedef {string|number|Node|null|undefined|false} Child
 * @typedef {Record<string, unknown> & {
 *   class?: string, dataset?: Record<string, string>, style?: Record<string, string>,
 *   on?: Record<string, EventListener>
 * }} Props
 */

/**
 * Create an element. Props: `class`, `dataset`, `style`, `on` (event map),
 * boolean attrs (true → present, false → absent), anything else as attribute
 * (or as property for value/checked/selected/disabled/hidden).
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {Props|null} [props]
 * @param {...(Child|Child[])} children
 * @returns {HTMLElementTagNameMap[K]}
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null) continue;
    if (key === 'class') el.className = String(value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'style') Object.assign(el.style, value);
    else if (key === 'on') {
      for (const [type, fn] of Object.entries(
        /** @type {Record<string, EventListener>} */ (value),
      )) {
        el.addEventListener(type, fn);
      }
    } else if (['value', 'checked', 'selected', 'disabled', 'hidden'].includes(key)) {
      /** @type {any} */ (el)[key] = value;
    } else if (value === true) el.setAttribute(key, '');
    else if (value !== false) el.setAttribute(key, String(value));
  }
  append(el, children);
  return el;
}

/**
 * @param {Node} parent
 * @param {(Child|Child[])[]} children
 */
function append(parent, children) {
  for (const child of children) {
    if (Array.isArray(child)) append(parent, child);
    else if (child === null || child === undefined || child === false) continue;
    else parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/**
 * Replace all children of `el`.
 *
 * Chrome throws `NotFoundError: The node to be removed is no longer a child of
 * this node` when `replaceChildren()` detaches the focused element: removal
 * fires blur, and the focus fix-up can mutate the child list while it is being
 * emptied. Re-rendering from a `change` handler on a control inside the view
 * (duration, cut, format) hits exactly that. Blur while the element is still
 * attached; views that need focus back restore it after rendering through
 * `data-focus-key`.
 * @param {Element} el
 * @param {...(Child|Child[])} children
 */
export function mount(el, ...children) {
  const active = /** @type {HTMLElement|null} */ (
    typeof document === 'undefined' ? null : document.activeElement
  );
  if (active && active !== el && el.contains(active) && typeof active.blur === 'function') {
    active.blur();
  }
  el.replaceChildren();
  append(el, children);
}

/**
 * Append `text` to `parent`, wrapping highlight ranges in <mark>.
 * @param {string} text
 * @param {{start:number,end:number}[]} ranges
 * @returns {DocumentFragment}
 */
export function highlighted(text, ranges) {
  const frag = document.createDocumentFragment();
  let cursor = 0;
  for (const { start, end } of ranges) {
    if (start > cursor) frag.append(text.slice(cursor, start));
    frag.append(h('mark', null, text.slice(start, end)));
    cursor = end;
  }
  if (cursor < text.length) frag.append(text.slice(cursor));
  return frag;
}
