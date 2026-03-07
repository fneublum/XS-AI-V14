import React from 'react';

/**
 * Safe markdown renderer - converts markdown text to React elements
 * without using dangerouslySetInnerHTML. Escapes HTML entities first,
 * then applies formatting via React elements.
 */

const escapeHtml = (text: string): string => {
    // Only escape < and > to prevent HTML injection.
    // " and & don't need escaping since we render via React elements (not innerHTML).
    return text
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
};

/** Parse inline markdown (bold, italic, code) into React elements */
const parseInline = (text: string, keyPrefix: string = ''): React.ReactNode[] => {
    const escaped = escapeHtml(text);
    const parts: React.ReactNode[] = [];
    // Match **bold**, *italic*, `code` patterns
    const regex = /\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let i = 0;

    while ((match = regex.exec(escaped)) !== null) {
        // Add text before match
        if (match.index > lastIndex) {
            parts.push(escaped.slice(lastIndex, match.index));
        }

        if (match[1]) {
            // **bold**
            parts.push(<strong key={`${keyPrefix}b${i}`}>{match[1]}</strong>);
        } else if (match[2]) {
            // *italic*
            parts.push(<em key={`${keyPrefix}i${i}`}>{match[2]}</em>);
        } else if (match[3]) {
            // `code`
            parts.push(
                <code key={`${keyPrefix}c${i}`} className="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded text-xs font-mono">
                    {match[3]}
                </code>
            );
        }

        lastIndex = match.index + match[0].length;
        i++;
    }

    // Add remaining text
    if (lastIndex < escaped.length) {
        parts.push(escaped.slice(lastIndex));
    }

    return parts.length > 0 ? parts : [escaped];
};

export const renderMarkdown = (text: string): React.ReactNode => {
    const lines = text.split('\n');
    const elements: React.ReactNode[] = [];
    let listItems: { text: string; key: string }[] = [];
    let listType: 'ul' | 'ol' | null = null;

    const flushList = () => {
        if (listItems.length > 0 && listType) {
            const items = listItems.map((item) => (
                <li key={item.key} className="ml-4">
                    {parseInline(item.text, item.key)}
                </li>
            ));
            if (listType === 'ol') {
                elements.push(
                    <ol key={`ol-${elements.length}`} className="list-decimal space-y-0.5 my-1 pl-4">
                        {items}
                    </ol>
                );
            } else {
                elements.push(
                    <ul key={`ul-${elements.length}`} className="list-disc space-y-0.5 my-1 pl-4">
                        {items}
                    </ul>
                );
            }
            listItems = [];
            listType = null;
        }
    };

    lines.forEach((line, idx) => {
        const trimmed = line.trim();

        // Heading (### / ## / #)
        const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)/);
        if (headingMatch) {
            flushList();
            const level = headingMatch[1].length;
            const cls = level === 1 ? 'text-base font-bold my-1' : level === 2 ? 'text-sm font-bold my-1' : 'text-sm font-semibold my-0.5';
            elements.push(
                <p key={idx} className={cls}>
                    {parseInline(headingMatch[2], `h${idx}`)}
                </p>
            );
            return;
        }

        // Numbered list
        const olMatch = trimmed.match(/^\d+\.\s+(.+)/);
        if (olMatch) {
            if (listType !== 'ol') flushList();
            listType = 'ol';
            listItems.push({ text: olMatch[1], key: `li-${idx}` });
            return;
        }

        // Bullet list
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.startsWith('• ')) {
            if (listType !== 'ul') flushList();
            listType = 'ul';
            listItems.push({ text: trimmed.slice(2), key: `li-${idx}` });
            return;
        }

        flushList();

        if (!trimmed) {
            elements.push(<div key={idx} className="h-2" />);
        } else {
            elements.push(
                <p key={idx} className="my-0.5">
                    {parseInline(trimmed, `p${idx}`)}
                </p>
            );
        }
    });

    flushList();
    return <>{elements}</>;
};

export default renderMarkdown;
