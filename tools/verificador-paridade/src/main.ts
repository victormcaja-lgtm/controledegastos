import { writeFile } from 'node:fs/promises';
import { ConfigError, loadConfig } from './config.js';
import { connect } from './db.js';
import { formatReport } from './report.js';
import { isClean, verify } from './verify.js';

/**
 * Saída: 0 = 0 diferenças; 1 = há diferenças; 2 = configuração inválida ou erro.
 */
async function main(): Promise<number> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      return 2;
    }
    throw error;
  }

  const db = connect(config.databaseUrl);
  try {
    const report = await verify(config, db, (line) => console.log(line));
    console.log(formatReport(report));
    if (config.reportPath) {
      await writeFile(config.reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      console.log(`Relatório: ${config.reportPath}`);
    }
    return isClean(report) ? 0 : 1;
  } finally {
    await db.end();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error);
    process.exitCode = 2;
  },
);
