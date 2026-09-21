import { describe, expect, it } from 'vitest';
import { NoteSearch } from '../src/notes/search.js';

function doc(noteId: string, title: string, body: string, tags: string[] = []) {
  return { noteId, title, body, tags };
}

describe('token search', () => {
  it('finds by title and body', () => {
    const s = new NoteSearch();
    s.rebuild([doc('a', 'Shopping list', 'buy milk and eggs'), doc('b', 'Work plan', 'ship the release')]);
    expect(s.query('shopping')).toEqual(['a']);
    expect(s.query('release')).toEqual(['b']);
  });

  it('requires all terms and matches tags', () => {
    const s = new NoteSearch();
    s.rebuild([
      doc('a', 'Trip', 'pack bags', ['travel']),
      doc('b', 'Travel guide', 'pack camera', ['travel'])
    ]);
    expect(s.query('pack travel')).toEqual(expect.arrayContaining(['a', 'b']));
    expect(s.query('camera')).toEqual(['b']);
    expect(s.query('camera bags')).toEqual([]);
  });

  it('supports prefix terms', () => {
    const s = new NoteSearch();
    s.rebuild([doc('a', 'Meeting notes', 'discuss roadmap')]);
    expect(s.query('meet')).toEqual(['a']);
    expect(s.query('road')).toEqual(['a']);
  });

  it('drops removed notes and rebuilds cleanly', () => {
    const s = new NoteSearch();
    s.rebuild([doc('a', 'Alpha', 'first'), doc('b', 'Beta', 'second')]);
    s.remove('a');
    expect(s.query('first')).toEqual([]);
    expect(s.size).toBe(1);
    s.rebuild([doc('c', 'Gamma', 'third')]);
    expect(s.query('second')).toEqual([]);
    expect(s.query('third')).toEqual(['c']);
  });

  it('returns all ids on empty query', () => {
    const s = new NoteSearch();
    s.rebuild([doc('a', 'A', 'x'), doc('b', 'B', 'y')]);
    expect(s.query('').sort()).toEqual(['a', 'b']);
  });
});
