import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { RollingFileLogger } from '../server/src/serverLogger';

describe('serverLogger', () => {
  it('rotates log files when the active log exceeds the configured size', async () => {
    const logDir = await mkdtemp(join(tmpdir(), 'simple-pdf-parser-logs-'));

    try {
      const logger = new RollingFileLogger({
        enabled: true,
        dir: logDir,
        fileName: 'server.log',
        maxBytes: 90,
        maxFiles: 3
      });

      logger.enqueue('INFO', ['first log entry that is intentionally long enough to trigger rotation soon'], () => {});
      logger.enqueue('INFO', ['second log entry that should roll the file'], () => {});
      logger.enqueue('ERROR', ['third log entry after rotation'], () => {});
      await logger.close();

      const files = (await readdir(logDir)).sort();
      expect(files).toContain('server.log');
      expect(files).toContain('server.log.1');

      const currentLog = await readFile(join(logDir, 'server.log'), 'utf8');
      const rolledLogs = await Promise.all(
        files
          .filter((fileName) => fileName.startsWith('server.log.'))
          .map((fileName) => readFile(join(logDir, fileName), 'utf8'))
      );
      const combinedRolledLogs = rolledLogs.join('\n');

      expect(currentLog).toContain('third log entry after rotation');
      expect(combinedRolledLogs).toContain('first log entry');
    } finally {
      await rm(logDir, { recursive: true, force: true });
    }
  });
});
