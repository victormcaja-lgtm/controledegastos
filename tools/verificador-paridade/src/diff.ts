/** Uma diferença entre a resposta do Node (`node`) e a do .NET (`dotnet`). */
export interface Difference {
  /** Caminho no JSON, no estilo `$.items[0].amountCents`; `$` é a raiz. */
  path: string;
  node: unknown;
  dotnet: unknown;
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

function childPath(parent: string, key: string): string {
  return IDENTIFIER.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

function kind(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Compara dois valores JSON campo a campo, sem normalização nenhuma: a ordem dos
 * itens de uma lista conta, `null` é diferente de campo ausente e `1` é diferente
 * de `"1"`. O critério do plano é 0 diferenças, então qualquer desvio é relatado.
 *
 * A ordem das CHAVES de um objeto não conta (o `JSON.parse` não a preserva de
 * forma significativa para o contrato). Para no `limit`-ésimo achado.
 */
export function diffJson(node: unknown, dotnet: unknown, limit = 20): Difference[] {
  const found: Difference[] = [];

  const walk = (a: unknown, b: unknown, path: string): void => {
    if (found.length >= limit) return;
    const kindA = kind(a);
    const kindB = kind(b);
    if (kindA !== kindB) {
      found.push({ path, node: a, dotnet: b });
      return;
    }
    if (kindA === 'array') {
      const listA = a as unknown[];
      const listB = b as unknown[];
      if (listA.length !== listB.length) {
        found.push({ path: `${path}.length`, node: listA.length, dotnet: listB.length });
      }
      const shared = Math.min(listA.length, listB.length);
      for (let index = 0; index < shared; index += 1) walk(listA[index], listB[index], `${path}[${index}]`);
      return;
    }
    if (kindA === 'object') {
      const objA = a as Record<string, unknown>;
      const objB = b as Record<string, unknown>;
      const keys = new Set([...Object.keys(objA), ...Object.keys(objB)]);
      for (const key of [...keys].sort()) {
        const next = childPath(path, key);
        if (!(key in objA)) found.push({ path: next, node: '(ausente)', dotnet: objB[key] });
        else if (!(key in objB)) found.push({ path: next, node: objA[key], dotnet: '(ausente)' });
        else walk(objA[key], objB[key], next);
        if (found.length >= limit) return;
      }
      return;
    }
    if (!Object.is(a, b)) found.push({ path, node: a, dotnet: b });
  };

  walk(node, dotnet, '$');
  return found;
}
