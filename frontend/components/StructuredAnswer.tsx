'use client';

import { Fragment, useMemo, type ReactNode } from 'react';
import { motion } from 'framer-motion';

/**
 * Renders structured Markdown emitted by the RAG backend: headings,
 * tables, bullet and numbered lists, code, blockquotes, and paragraphs with inline
 * bold/italic/code and page citations.
 */

type Block =
  | { kind: 'heading'; level: 2 | 3; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'numbers'; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'table'; headers: string[]; rows: string[][] };

const BULLET_RE = /^\s*[-*•]\s+(.*)$/;
const NUMBER_RE = /^\s*\d+[.)]\s+(.*)$/;
const HEADING_RE = /^\s*(#{1,6})\s+(.*)$/;
const QUOTE_RE = /^\s*>\s?(.*)$/;
const FENCE_RE = /^\s*```/;
const BOLD_LINE_RE = /^\s*\*\*(.+?)\*\*:?\s*$/;
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;

function parseTableCell(line: string): string[] {
  const parts = line.split('|');
  if (parts.length < 2) return [];
  // Slice off the outer empty parts caused by leading/trailing pipes
  const start = parts[0].trim() === '' ? 1 : 0;
  const end = parts[parts.length - 1].trim() === '' ? parts.length - 1 : parts.length;
  return parts.slice(start, end).map((cell) => cell.trim());
}

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const text = paragraph.join(' ').trim();
    if (text) blocks.push({ kind: 'paragraph', text });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (FENCE_RE.test(line)) {
      flushParagraph();
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE_RE.test(lines[i])) {
        code.push(lines[i]);
        i += 1;
      }
      if (code.length) blocks.push({ kind: 'code', text: code.join('\n') });
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    // Markdown Table parsing
    if (TABLE_ROW_RE.test(line)) {
      flushParagraph();
      const headers = parseTableCell(line);
      const rows: string[][] = [];
      i += 1;

      // Check if next line is divider line like |---|---|
      if (i < lines.length && TABLE_ROW_RE.test(lines[i]) && lines[i].includes('---')) {
        i += 1;
      }

      while (i < lines.length && TABLE_ROW_RE.test(lines[i])) {
        const rowCells = parseTableCell(lines[i]);
        if (rowCells.length > 0) rows.push(rowCells);
        i += 1;
      }
      i -= 1; // Adjust step since outer loop increments

      if (headers.length > 0) {
        blocks.push({ kind: 'table', headers, rows });
      }
      continue;
    }

    const heading = line.match(HEADING_RE);
    if (heading) {
      flushParagraph();
      blocks.push({
        kind: 'heading',
        level: heading[1].length <= 2 ? 2 : 3,
        text: heading[2].trim(),
      });
      continue;
    }

    const boldLine = line.match(BOLD_LINE_RE);
    if (boldLine) {
      flushParagraph();
      blocks.push({ kind: 'heading', level: 3, text: boldLine[1].trim() });
      continue;
    }

    const bullet = line.match(BULLET_RE);
    if (bullet) {
      flushParagraph();
      const last = blocks[blocks.length - 1];
      if (last && last.kind === 'bullets') last.items.push(bullet[1].trim());
      else blocks.push({ kind: 'bullets', items: [bullet[1].trim()] });
      continue;
    }

    const numbered = line.match(NUMBER_RE);
    if (numbered) {
      flushParagraph();
      const last = blocks[blocks.length - 1];
      if (last && last.kind === 'numbers') last.items.push(numbered[1].trim());
      else blocks.push({ kind: 'numbers', items: [numbered[1].trim()] });
      continue;
    }

    const quote = line.match(QUOTE_RE);
    if (quote) {
      flushParagraph();
      const last = blocks[blocks.length - 1];
      if (last && last.kind === 'quote') last.text += ` ${quote[1].trim()}`;
      else blocks.push({ kind: 'quote', text: quote[1].trim() });
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
  return blocks;
}

const INLINE_RE = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\n]+\*|\(p+\.\s*\d+[^)]*\))/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return text.split(INLINE_RE).map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (!part) return null;

    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code key={key} className="sa-code">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={key} className="sa-strong">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return (
        <em key={key} className="sa-em">
          {part.slice(1, -1)}
        </em>
      );
    }
    if (/^\(p+\.\s*\d+/.test(part)) {
      return (
        <span key={key} className="sa-cite">
          {part}
        </span>
      );
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}

interface StructuredAnswerProps {
  text: string;
  animate?: boolean;
}

export default function StructuredAnswer({ text, animate = false }: StructuredAnswerProps) {
  const blocks = useMemo(() => parseBlocks(text), [text]);

  return (
    <div className="sa-root">
      {blocks.map((block, index) => {
        const key = `b${index}`;
        const inner = renderBlock(block, key);
        if (!animate) {
          return <Fragment key={key}>{inner}</Fragment>;
        }
        return (
          <motion.div
            key={key}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(index * 0.08, 1.2), duration: 0.28 }}
          >
            {inner}
          </motion.div>
        );
      })}

      <style>{`
        .sa-root :global(.sa-h2),
        .sa-root :global(.sa-h3) {
          margin: 18px 0 8px;
          color: #ffffff;
          font-weight: 700;
          line-height: 1.35;
        }
        .sa-root :global(.sa-h2) {
          font-size: 17px;
          letter-spacing: -0.01em;
        }
        .sa-root :global(.sa-h3) {
          font-size: 15px;
          color: rgba(255, 255, 255, 0.92);
        }
        .sa-root > :global(*:first-child) :global(.sa-h2),
        .sa-root > :global(*:first-child) :global(.sa-h3) {
          margin-top: 0;
        }
        .sa-root :global(.sa-p) {
          margin: 0 0 12px;
          line-height: 1.75;
        }
        .sa-root :global(.sa-list) {
          margin: 0 0 12px;
          padding-left: 4px;
          list-style: none;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .sa-root :global(.sa-li) {
          display: flex;
          gap: 10px;
          line-height: 1.65;
        }
        .sa-root :global(.sa-marker) {
          flex-shrink: 0;
          color: #818cf8;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
        .sa-root :global(.sa-dot) {
          flex-shrink: 0;
          width: 6px;
          height: 6px;
          margin-top: 10px;
          border-radius: 50%;
          background: #818cf8;
        }
        .sa-root :global(.sa-quote) {
          margin: 0 0 12px;
          padding: 8px 0 8px 14px;
          border-left: 2px solid rgba(99, 102, 241, 0.5);
          color: rgba(255, 255, 255, 0.7);
          font-style: italic;
        }
        .sa-root :global(.sa-pre) {
          margin: 0 0 12px;
          padding: 14px 16px;
          overflow-x: auto;
          background: rgba(0, 0, 0, 0.45);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 12px;
          font-size: 13px;
          line-height: 1.6;
        }
        .sa-root :global(.sa-table-wrap) {
          overflow-x: auto;
          margin: 16px 0;
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(255, 255, 255, 0.02);
        }
        .sa-root :global(.sa-table) {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
          text-align: left;
        }
        .sa-root :global(.sa-th) {
          background: rgba(37, 99, 235, 0.2);
          color: #ffffff;
          font-weight: 700;
          padding: 10px 14px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.12);
        }
        .sa-root :global(.sa-td) {
          padding: 10px 14px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
          color: rgba(255, 255, 255, 0.85);
        }
        .sa-root :global(.sa-tr:hover) {
          background: rgba(255, 255, 255, 0.03);
        }
        .sa-root :global(.sa-strong) {
          color: #ffffff;
          font-weight: 700;
        }
        .sa-root :global(.sa-em) {
          font-style: italic;
          color: rgba(255, 255, 255, 0.9);
        }
        .sa-root :global(.sa-code) {
          padding: 2px 6px;
          background: rgba(129, 140, 248, 0.12);
          border: 1px solid rgba(129, 140, 248, 0.2);
          border-radius: 6px;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 0.9em;
          color: #c7d2fe;
        }
        .sa-root :global(.sa-cite) {
          color: #a5b4fc;
          font-size: 0.86em;
          white-space: nowrap;
        }
      `}</style>
    </div>
  );
}

function renderBlock(block: Block, key: string): ReactNode {
  switch (block.kind) {
    case 'heading':
      return block.level === 2 ? (
        <h2 className="sa-h2">{renderInline(block.text, key)}</h2>
      ) : (
        <h3 className="sa-h3">{renderInline(block.text, key)}</h3>
      );
    case 'table':
      return (
        <div className="sa-table-wrap">
          <table className="sa-table">
            {block.headers.length > 0 && (
              <thead>
                <tr>
                  {block.headers.map((h, i) => (
                    <th key={i} className="sa-th">{renderInline(h, `${key}-h${i}`)}</th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {block.rows.map((row, ri) => (
                <tr key={ri} className="sa-tr">
                  {row.map((cell, ci) => (
                    <td key={ci} className="sa-td">{renderInline(cell, `${key}-r${ri}-c${ci}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'bullets':
      return (
        <ul className="sa-list">
          {block.items.map((item, i) => (
            <li key={i} className="sa-li">
              <span className="sa-dot" aria-hidden />
              <span>{renderInline(item, `${key}-${i}`)}</span>
            </li>
          ))}
        </ul>
      );
    case 'numbers':
      return (
        <ol className="sa-list">
          {block.items.map((item, i) => (
            <li key={i} className="sa-li">
              <span className="sa-marker">{i + 1}.</span>
              <span>{renderInline(item, `${key}-${i}`)}</span>
            </li>
          ))}
        </ol>
      );
    case 'quote':
      return <blockquote className="sa-quote">{renderInline(block.text, key)}</blockquote>;
    case 'code':
      return (
        <pre className="sa-pre">
          <code>{block.text}</code>
        </pre>
      );
    case 'paragraph':
    default:
      return <p className="sa-p">{renderInline(block.text, key)}</p>;
  }
}
