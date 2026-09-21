export interface SearchDoc {
  noteId: string;
  title: string;
  body: string;
  tags: string[];
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

function docTokens(doc: SearchDoc): string[] {
  return [...tokenize(doc.title), ...tokenize(doc.body), ...doc.tags.flatMap((t) => tokenize(t))];
}

export class NoteSearch {
  private postings = new Map<string, Set<string>>();
  private docs = new Map<string, SearchDoc>();

  get size(): number {
    return this.docs.size;
  }

  rebuild(docs: SearchDoc[]): void {
    this.postings.clear();
    this.docs.clear();
    for (const doc of docs) this.add(doc);
  }

  add(doc: SearchDoc): void {
    this.remove(doc.noteId);
    this.docs.set(doc.noteId, doc);
    for (const token of new Set(docTokens(doc))) {
      let set = this.postings.get(token);
      if (!set) {
        set = new Set();
        this.postings.set(token, set);
      }
      set.add(doc.noteId);
    }
  }

  remove(noteId: string): void {
    if (!this.docs.has(noteId)) return;
    this.docs.delete(noteId);
    for (const [token, set] of this.postings) {
      set.delete(noteId);
      if (set.size === 0) this.postings.delete(token);
    }
  }

  clear(): void {
    this.postings.clear();
    this.docs.clear();
  }

  query(raw: string): string[] {
    const terms = tokenize(raw);
    if (terms.length === 0) {
      return [...this.docs.keys()];
    }
    const scores = new Map<string, number>();
    for (const term of terms) {
      for (const [token, ids] of this.postings) {
        if (token === term || token.startsWith(term)) {
          const exact = token === term ? 2 : 1;
          for (const id of ids) scores.set(id, (scores.get(id) ?? 0) + exact);
        }
      }
    }
    const matched = [...scores.entries()].filter(([, score]) => score > 0);
    matched.sort((a, b) => b[1] - a[1]);
    return matched
      .filter(([id]) => {
        const doc = this.docs.get(id);
        if (!doc) return false;
        const tokens = new Set(docTokens(doc));
        return terms.every((t) => [...tokens].some((tok) => tok === t || tok.startsWith(t)));
      })
      .map(([id]) => id)
      .slice(0, 100);
  }
}
