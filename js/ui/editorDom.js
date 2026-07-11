// @ts-check

/**
 * Required editor controls are defined in the static application shell.
 * Keep the dynamic lookup in one place and fail with the drifting id.
 * The editors contain mixed input/select/form/display nodes, so callers
 * narrow query-created controls while this boundary remains intentionally
 * permissive for named shell controls.
 * @param {string} id
 * @returns {any}
 */
export function editorElement(id) {
    const element = document.getElementById(id);
    if (!(element instanceof HTMLElement)) throw new Error(`Missing required editor element #${id}`);
    return element;
}

/**
 * Type and validate dynamic editor controls selected by CSS.
 * @template {Element} T
 * @param {ParentNode} root
 * @param {string} selector
 * @param {new (...args: any[]) => T} ElementType
 * @returns {T[]}
 */
export function editorElements(root, selector, ElementType) {
    const elements = Array.from(root.querySelectorAll(selector));
    if (elements.some(element => !(element instanceof ElementType))) {
        throw new Error(`Invalid editor element matching ${selector}`);
    }
    return /** @type {T[]} */ (elements);
}

/**
 * Return one optional, type-checked dynamic editor control.
 * @template {Element} T
 * @param {ParentNode} root
 * @param {string} selector
 * @param {new (...args: any[]) => T} ElementType
 * @returns {T|null}
 */
export function optionalEditorElement(root, selector, ElementType) {
    const element = root.querySelector(selector);
    if (element === null || element instanceof ElementType) return element;
    throw new Error(`Invalid editor element matching ${selector}`);
}
