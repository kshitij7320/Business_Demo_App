import { env } from './config/env.js';
import { DataStore } from './storage/dataStore.js';
import { createApp } from './app.js';

async function bootstrap() {
  console.log(`[BOOT] Initializing StockPulse database at ${env.STORAGE_DIR}...`);
  const dataStore = new DataStore(env.STORAGE_DIR, {
    backupRetentionCount: env.BACKUP_RETENTION_COUNT
  });

  await dataStore.init();
  console.log('[BOOT] Database storage engine & WAL initialized successfully.');

  const app = createApp(dataStore);

  const server = app.listen(env.PORT, () => {
    console.log(`\n======================================================`);
    console.log(`🚀 StockPulse Management System running on port ${env.PORT}`);
    console.log(`🌐 Local Web UI: http://localhost:${env.PORT}`);
    console.log(`📡 API Base URL: http://localhost:${env.PORT}/api/v1`);
    console.log(`💼 Company GSTIN: ${env.COMPANY_GSTIN} (State: ${env.COMPANY_STATE_CODE})`);
    console.log(`======================================================\n`);
  });

  // Graceful termination handling
  const shutdown = async (signal) => {
    console.log(`\n[SHUTDOWN] Received ${signal}. Gracefully stopping HTTP server and flushing storage...`);
    server.close(async () => {
      try {
        await dataStore.close();
        console.log('[SHUTDOWN] Storage engine closed cleanly. Exiting.');
        process.exit(0);
      } catch (err) {
        console.error('[SHUTDOWN ERROR]', err);
        process.exit(1);
      }
    });

    // Force exit after 5s timeout if server does not close
    setTimeout(() => {
      console.error('[SHUTDOWN] Timed out waiting for connections to close. Forcing exit.');
      process.exit(1);
    }, 5000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch(err => {
  console.error('[FATAL BOOTSTRAP ERROR]', err);
  process.exit(1);
});
