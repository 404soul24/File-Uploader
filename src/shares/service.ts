import { createHash, randomBytes } from 'node:crypto';
import { Prisma, type Folder, type FolderShare, type PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';
import { getOwnedFolder } from '../folders/service.js';

export class ShareNotFoundError extends Error {
  constructor() {
    super('This share link is invalid, expired, or no longer available.');
    this.name = 'ShareNotFoundError';
  }
}

export function hashShareToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function getShareExpiry(durationDays: number) {
  return new Date(Date.now() + durationDays * 24 * 60 * 60 * 1_000);
}

export function createFolderShare(
  database: PrismaClient,
  ownerId: string,
  folderId: string,
  durationDays: number,
) {
  return database.$transaction(
    async (transaction) => {
      await getOwnedFolder(transaction, ownerId, folderId);
      const token = randomBytes(32).toString('base64url');

      const share = await transaction.folderShare.create({
        data: {
          tokenHash: hashShareToken(token),
          durationDays,
          expiresAt: getShareExpiry(durationDays),
          folderId,
          createdById: ownerId,
        },
      });

      return {
        share,
        token,
        url: new URL(`/share/${token}`, env.APP_URL).toString(),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export function listFolderShares(database: PrismaClient, ownerId: string) {
  return database.folderShare.findMany({
    where: { createdById: ownerId },
    include: { folder: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

export function revokeFolderShare(database: PrismaClient, ownerId: string, shareId: string) {
  return database.folderShare.updateMany({
    where: { id: shareId, createdById: ownerId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

async function findActiveShare(database: PrismaClient, token: string) {
  const share = await database.folderShare.findFirst({
    where: {
      tokenHash: hashShareToken(token),
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: { folder: true },
  });

  if (!share) {
    throw new ShareNotFoundError();
  }

  return share;
}

async function getFolderWithinShare(
  database: PrismaClient,
  share: FolderShare & { folder: Folder },
  folderId: string,
) {
  const lineage: Folder[] = [];
  const visited = new Set<string>();
  let currentId: string | null = folderId;

  while (currentId) {
    if (visited.has(currentId)) {
      throw new ShareNotFoundError();
    }

    visited.add(currentId);
    const folder: Folder | null = await database.folder.findFirst({
      where: { id: currentId, ownerId: share.folder.ownerId },
    });

    if (!folder) {
      throw new ShareNotFoundError();
    }

    lineage.push(folder);
    if (folder.id === share.folderId) {
      const targetFolder = lineage[0];
      if (!targetFolder) {
        throw new ShareNotFoundError();
      }

      return { folder: targetFolder, breadcrumbs: lineage.reverse() };
    }

    currentId = folder.parentId;
  }

  throw new ShareNotFoundError();
}

export async function getSharedFolderContext(
  database: PrismaClient,
  token: string,
  folderId: string | null,
) {
  const share = await findActiveShare(database, token);

  if (!folderId || folderId === share.folderId) {
    return { share, folder: share.folder, breadcrumbs: [share.folder] };
  }

  const context = await getFolderWithinShare(database, share, folderId);
  return { share, ...context };
}

export async function getSharedFile(database: PrismaClient, token: string, fileId: string) {
  const share = await findActiveShare(database, token);
  const file = await database.file.findFirst({
    where: { id: fileId, ownerId: share.folder.ownerId, folderId: { not: null } },
  });

  if (!file?.folderId) {
    throw new ShareNotFoundError();
  }

  const context = await getFolderWithinShare(database, share, file.folderId);
  return { share, file, folder: context.folder };
}
