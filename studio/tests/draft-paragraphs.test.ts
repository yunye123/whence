import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { analyzeDraftStructure } from '../src/inspector/draft-editor/markdown';
import { analyzeDraftReferences } from '../src/inspector/draft-editor/references';
import { draftParagraphIndexAt } from '../src/source-location';
import { draftCitations } from '../src/canvas/edges/model';
import { draftUses } from '../src/inspector/video-watch';
import { createExampleBoard } from '../src/templates';
import { createBoard } from '../src/storage';
import { parseDraftReferences } from '../src/draft-references';
import type { Board } from '../src/model';

/** The numbers the writing page draws in its left margin, per line (0 where none). */
function writingPageNumbers(body: string): { line: number; number: number }[] {
  const state = EditorState.create({ doc: body });
  const referenceLines = new Set<number>();
  for (const span of analyzeDraftReferences(state.doc.toString())) {
    const line = state.doc.lineAt(span.from);
    let rest = line.text;
    for (const other of analyzeDraftReferences(state.doc.toString()).filter(item => item.from >= line.from && item.to <= line.to).sort((a, b) => b.from - a.from)) {
      rest = rest.slice(0, other.from - line.from) + rest.slice(other.to - line.from);
    }
    if (!rest.trim()) referenceLines.add(line.number);
  }
  const structure = analyzeDraftStructure(state.doc, referenceLines);
  return [...structure.paragraph.entries()].filter(([, value]) => value > 0).map(([line, number]) => ({ line, number }));
}

const drafts = (board: Board) => board.nodes.filter(node => node.data.kind === 'draft' && node.data.body);
const boards = () => [createExampleBoard('writing'), createExampleBoard('video'), createExampleBoard('creative'), createBoard('demo')];

test('CORE-01: every numbered line of the writing page reads the same number from draftParagraphIndexAt', () => {
  const extra = '# 题目\n\n第一段。\n\n> 引文\n\n[来源：资料](field://node/s)\n\n第三段，\n同一段的第二行。\n\n## 小节\n\n- 列表一\n- 列表二\n\n```\n代码\n\n代码二\n```\n\n结尾 [来源：资料](field://node/s) 一句。';
  for (const body of [...boards().flatMap(board => drafts(board).map(node => node.data.body)), extra]) {
    const state = EditorState.create({ doc: body });
    const numbered = writingPageNumbers(body);
    assert.ok(numbered.length > 0);
    for (const { line, number } of numbered) {
      const at = state.doc.line(line);
      assert.equal(draftParagraphIndexAt(body, at.from), number, `line ${line} “${at.text.slice(0, 12)}”`);
      assert.equal(draftParagraphIndexAt(body, at.to), number);
    }
  }
});

test('CORE-01: the citation thread, the watch page provenance and the writing page name the same paragraph', () => {
  for (const board of boards()) {
    for (const draft of drafts(board)) {
      const body = draft.data.body;
      const references = parseDraftReferences(body);
      const state = EditorState.create({ doc: body });
      const numbered = writingPageNumbers(body);
      // The paragraph the writing page shows a reference in: the nearest numbered line at or above it.
      const shown = (offset: number) => {
        const line = state.doc.lineAt(offset).number;
        return [...numbered].reverse().find(entry => entry.line <= line)?.number ?? numbered[0]?.number;
      };
      for (const cite of draftCitations(body).cites) {
        const reference = references[cite.index];
        assert.equal(cite.paragraph, shown(reference.from), `${board.title}: thread to ${cite.key}`);
      }
      for (const video of board.nodes.filter(node => node.data.kind === 'video')) {
        const quotes = board.nodes.filter(node => node.data.kind === 'quote' && node.data.citation?.nodeId === video.id)
          .map(node => ({ id: node.id, start: node.data.citation?.start ?? 0, end: node.data.citation?.end ?? 0 }));
        for (const [quoteId, uses] of draftUses(board.nodes, video.id, quotes as never)) {
          for (const use of uses.filter(item => item.draftId === draft.id)) {
            const reference = references.find(item => item.quoteNodeId === quoteId)!;
            assert.equal(use.paragraph, shown(reference.from), `${board.title}: provenance of ${quoteId}`);
            const thread = draftCitations(body).cites.find(cite => cite.key === quoteId);
            if (thread) assert.equal(use.paragraph, thread.paragraph, 'the provenance and the thread agree');
          }
        }
      }
    }
  }
});

test('CORE-01: offsets outside any numbered block fold into the paragraph above, else below', () => {
  const body = '[来源：资料](field://node/s)\n\n# 题目\n\n第一段。\n\n[来源：资料](field://node/s)\n\n第二段。';
  assert.equal(draftParagraphIndexAt(body, 0), 1, 'a reference before any paragraph belongs to the first one');
  assert.equal(draftParagraphIndexAt(body, body.indexOf('第一段')), 1);
  assert.equal(draftParagraphIndexAt(body, body.lastIndexOf('[来源')), 1, 'a reference line folds into the paragraph above');
  assert.equal(draftParagraphIndexAt(body, body.indexOf('第二段')), 2);
  assert.equal(draftParagraphIndexAt('', 0), undefined);
  assert.equal(draftParagraphIndexAt(body, body.length + 1), undefined);
});
