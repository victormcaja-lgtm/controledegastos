import { describe, expect, it } from 'vitest';
import { diffJson } from '../src/diff.js';

describe('diffJson', () => {
  it('valores iguais não têm diferença, mesmo com as chaves em outra ordem', () => {
    expect(diffJson({ a: 1, b: [1, { c: null }] }, { b: [1, { c: null }], a: 1 })).toEqual([]);
  });

  it('acha o caminho do campo diferente', () => {
    expect(diffJson({ items: [{ amountCents: 100 }] }, { items: [{ amountCents: 101 }] })).toEqual([
      { path: '$.items[0].amountCents', node: 100, dotnet: 101 },
    ]);
  });

  it('número e texto são diferentes', () => {
    expect(diffJson({ v: 1 }, { v: '1' })).toEqual([{ path: '$.v', node: 1, dotnet: '1' }]);
  });

  it('null é diferente de campo ausente', () => {
    expect(diffJson({ note: null }, {})).toEqual([{ path: '$.note', node: null, dotnet: '(ausente)' }]);
    expect(diffJson({}, { note: null })).toEqual([{ path: '$.note', node: '(ausente)', dotnet: null }]);
  });

  it('a ordem dos itens de uma lista conta', () => {
    expect(diffJson([1, 2], [2, 1])).toEqual([
      { path: '$[0]', node: 1, dotnet: 2 },
      { path: '$[1]', node: 2, dotnet: 1 },
    ]);
  });

  it('relata o tamanho diferente e compara a parte em comum', () => {
    expect(diffJson([1, 2, 3], [1, 9])).toEqual([
      { path: '$.length', node: 3, dotnet: 2 },
      { path: '$[1]', node: 2, dotnet: 9 },
    ]);
  });

  it('chave que não é identificador vira índice entre aspas', () => {
    expect(diffJson({ 'a-b': 1 }, { 'a-b': 2 })[0]?.path).toBe('$["a-b"]');
  });

  it('para no limite', () => {
    const a = Array.from({ length: 50 }, (_, i) => i);
    const b = Array.from({ length: 50 }, (_, i) => i + 1);
    expect(diffJson(a, b, 3)).toHaveLength(3);
  });
});
