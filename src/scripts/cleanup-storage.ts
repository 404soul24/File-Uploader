import { cleanupOrphanedStorage } from '../files/cleanup.js';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';

const dryRun = process.argv.includes('--dry-run');

try {
  const result = await cleanupOrphanedStorage({
    database: prisma,
    dryRun,
    storageDirectory: env.UPLOAD_DIR,
    temporaryFileTtlMinutes: env.TEMP_UPLOAD_TTL_MINUTES,
  });

  console.log(JSON.stringify(result, null, 2));
} finally {
  await prisma.$disconnect();
}
