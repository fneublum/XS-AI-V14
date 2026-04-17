// Minimal, dependency-free HTML sanitizer for rendering AI-generated or
// user-supplied content via dangerouslySetInnerHTML.
//
// Scope: enough to safely render email-style rich text previews. Allows
// common text-formatting tags, strips <script>, <style>, iframes, event
// handlers, and javascript:/data: URLs. Not intended for sanitizing full
// web pages or SVG — add DOMPurify if the surface area grows.

const ALLOWED_TAGS = new Set([
    'a', 'abbr', 'b', 'blockquote', 'br', 'code', 'div', 'em', 'h1', 'h2',
    'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'li', 'ol', 'p', 'pre', 'span',
    'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul',
]);

const ALLOWED_ATTRS_BY_TAG: Record<string, Set<string>> = {
    a: new Set(['href', 'title', 'target', 'rel']),
    '*': new Set(['class', 'style']),
};

// URL schemes that are safe to leave on href attributes. Anything else is
// stripped (notably javascript:, data:, vbscript:).
const SAFE_URL_SCHEMES = /^(https?:|mailto:|tel:|#|\/)/i;

function sanitizeNode(node: Element, doc: Document): void {
    const tag = node.tagName.toLowerCase();

    if (!ALLOWED_TAGS.has(tag)) {
        // Replace disallowed element with its text content so we don't lose
        // user-visible copy (but we lose the tag's behavior).
        const text = doc.createTextNode(node.textContent || '');
        node.parentNode?.replaceChild(text, node);
        return;
    }

    const tagAttrs = ALLOWED_ATTRS_BY_TAG[tag] ?? new Set<string>();
    const globalAttrs = ALLOWED_ATTRS_BY_TAG['*'];

    // Copy attribute list first — we're about to mutate it.
    const toRemove: string[] = [];
    for (const attr of Array.from(node.attributes)) {
        const name = attr.name.toLowerCase();

        // Always kill event handlers.
        if (name.startsWith('on')) {
            toRemove.push(attr.name);
            continue;
        }

        const allowed = tagAttrs.has(name) || globalAttrs.has(name);
        if (!allowed) {
            toRemove.push(attr.name);
            continue;
        }

        // For href-like attrs, enforce safe URL schemes.
        if (name === 'href' && !SAFE_URL_SCHEMES.test(attr.value.trim())) {
            toRemove.push(attr.name);
            continue;
        }

        // Strip url()/javascript: in style to kill CSS-based XSS.
        if (name === 'style' && /url\s*\(|expression\s*\(|javascript:/i.test(attr.value)) {
            toRemove.push(attr.name);
            continue;
        }
    }
    for (const name of toRemove) {
        node.removeAttribute(name);
    }

    // Anchor tags opening in new window should not be able to reach back via
    // window.opener — force safe rel.
    if (tag === 'a' && node.getAttribute('target')) {
        node.setAttribute('rel', 'noopener noreferrer');
    }

    for (const child of Array.from(node.children)) {
        sanitizeNode(child, doc);
    }
}

/**
 * Returns an HTML string safe to pass to dangerouslySetInnerHTML.
 * - Drops disallowed tags (replaces with their text content)
 * - Drops all event handlers (on*)
 * - Drops javascript:, data:, and other unsafe URL schemes
 * - Forces rel="noopener noreferrer" on anchors with target
 */
export function sanitizeHtml(raw: string): string {
    if (typeof raw !== 'string' || !raw) return '';

    // Use DOMParser so we get a real tree without touching the live DOM.
    const doc = new DOMParser().parseFromString(`<div>${raw}</div>`, 'text/html');
    const root = doc.body.firstElementChild as Element | null;
    if (!root) return '';

    for (const child of Array.from(root.children)) {
        sanitizeNode(child, doc);
    }

    return root.innerHTML;
}
