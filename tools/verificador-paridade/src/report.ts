import { isClean, type Report } from './verify.js';

/** Até quantas requisições com diferença o resumo em texto mostra (o JSON tem todas). */
const SHOWN_REQUESTS = 15;
const SHOWN_DIFFERENCES = 5;

function short(value: unknown): string {
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

export function formatReport(report: Report): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(`Node:  ${report.nodeUrl}`);
  lines.push(`.NET:  ${report.dotnetUrl}`);
  lines.push(`Hoje:  ${report.today} · semente ${report.seed} · ${report.sampledUsers} usuário(s)`);
  if (!report.adminChecked && report.modules.includes('Identity')) {
    lines.push('Admin: não verificado (nenhum administrador ativo)');
  }
  lines.push('');
  lines.push('Módulo         GETs  Diferentes');
  for (const module of report.modules) {
    const entry = report.perModule[module] ?? { requests: 0, different: 0 };
    lines.push(`${module.padEnd(14)} ${String(entry.requests).padStart(4)}  ${String(entry.different).padStart(10)}`);
  }

  if (report.different.length > 0) {
    lines.push('');
    lines.push(`Respostas diferentes (${report.different.length}):`);
    for (const result of report.different.slice(0, SHOWN_REQUESTS)) {
      lines.push(`  ${result.module} GET ${result.path}  (usuário ${result.userId})`);
      if (result.error) {
        lines.push(`    erro: ${result.error}`);
        continue;
      }
      for (const difference of result.differences.slice(0, SHOWN_DIFFERENCES)) {
        lines.push(`    ${difference.path}: node=${short(difference.node)} dotnet=${short(difference.dotnet)}`);
      }
      if (result.differences.length > SHOWN_DIFFERENCES) {
        lines.push(`    ... e mais ${result.differences.length - SHOWN_DIFFERENCES}`);
      }
    }
    if (report.different.length > SHOWN_REQUESTS) {
      lines.push(`  ... e mais ${report.different.length - SHOWN_REQUESTS} (veja o relatório JSON)`);
    }
  }

  if (report.countChanges.length > 0) {
    lines.push('');
    lines.push('Contagens que mudaram durante a verificação (algum GET gravou, ou houve escrita concorrente):');
    for (const change of report.countChanges) lines.push(`  ${change.key}: ${change.before} → ${change.after}`);
  }

  lines.push('');
  lines.push(
    isClean(report)
      ? `OK: ${report.totalRequests} GET(s) idênticos e contagens estáveis — 0 diferenças.`
      : `FALHOU: ${report.different.length} GET(s) diferentes, ${report.countChanges.length} contagem(ns) alterada(s).`,
  );
  return lines.join('\n');
}
