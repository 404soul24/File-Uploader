import { Prisma, type Folder, type PrismaClient } from '@prisma/client';

type DatabaseClient = PrismaClient | Prisma.TransactionClient;

export class FolderNotFoundError extends Error {
  constructor() {
    super('Folder not found.');
    this.name = 'FolderNotFoundError';
  }
}

export class FolderNameConflictError extends Error {
  constructor() {
    super('A folder with this name already exists here.');
    this.name = 'FolderNameConflictError';
  }
}

export class FolderHierarchyError extends Error {
  constructor() {
    super('The folder hierarchy is invalid.');
    this.name = 'FolderHierarchyError';
  }
}

export async function getOwnedFolder(
  database: DatabaseClient,
  ownerId: string,
  folderId: string,
): Promise<Folder> {
  const folder = await database.folder.findFirst({
    where: { id: folderId, ownerId },
  });

  if (!folder) {
    throw new FolderNotFoundError();
  }

  return folder;
}

export function listChildFolders(
  database: DatabaseClient,
  ownerId: string,
  parentId: string | null,
) {
  return database.folder.findMany({
    where: { ownerId, parentId },
    orderBy: { name: 'asc' },
  });
}

export async function getFolderBreadcrumbs(
  database: DatabaseClient,
  ownerId: string,
  folder: Folder,
) {
  const breadcrumbs: Folder[] = [];
  const visited = new Set<string>();
  let current: Folder | null = folder;

  while (current) {
    if (visited.has(current.id)) {
      throw new FolderHierarchyError();
    }

    visited.add(current.id);
    breadcrumbs.unshift(current);
    current = current.parentId
      ? await database.folder.findFirst({ where: { id: current.parentId, ownerId } })
      : null;
  }

  return breadcrumbs;
}

async function assertNameAvailable(
  database: DatabaseClient,
  ownerId: string,
  parentId: string | null,
  name: string,
  ignoredFolderId?: string,
) {
  const existing = await database.folder.findFirst({
    where: {
      ownerId,
      parentId,
      name: { equals: name, mode: 'insensitive' },
    },
    select: { id: true },
  });

  if (existing && existing.id !== ignoredFolderId) {
    throw new FolderNameConflictError();
  }
}

export function createFolder(
  database: PrismaClient,
  ownerId: string,
  name: string,
  parentId: string | null,
) {
  return database.$transaction(
    async (transaction) => {
      if (parentId) {
        await getOwnedFolder(transaction, ownerId, parentId);
      }

      await assertNameAvailable(transaction, ownerId, parentId, name);

      return transaction.folder.create({
        data: { name, ownerId, parentId },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export function renameFolder(
  database: PrismaClient,
  ownerId: string,
  folderId: string,
  name: string,
) {
  return database.$transaction(
    async (transaction) => {
      const folder = await getOwnedFolder(transaction, ownerId, folderId);
      await assertNameAvailable(transaction, ownerId, folder.parentId, name, folder.id);

      return transaction.folder.update({
        where: { id: folder.id },
        data: { name },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function getFolderDeletePreview(
  database: DatabaseClient,
  ownerId: string,
  folderId: string,
) {
  const folder = await getOwnedFolder(database, ownerId, folderId);
  const descendants = await getDescendantFolders(database, ownerId, folderId);
  return { folder, descendantCount: descendants.length };
}

async function getDescendantFolders(database: DatabaseClient, ownerId: string, rootId: string) {
  const descendants: Folder[] = [];
  const visited = new Set([rootId]);
  let frontier = [rootId];

  while (frontier.length > 0) {
    const children = await database.folder.findMany({
      where: { ownerId, parentId: { in: frontier } },
      orderBy: { createdAt: 'asc' },
    });
    const nextFrontier: string[] = [];

    for (const child of children) {
      if (visited.has(child.id)) {
        throw new FolderHierarchyError();
      }

      visited.add(child.id);
      descendants.push(child);
      nextFrontier.push(child.id);
    }

    frontier = nextFrontier;
  }

  return descendants;
}

export function deleteFolderRecursively(database: PrismaClient, ownerId: string, folderId: string) {
  return database.$transaction(
    async (transaction) => {
      await getOwnedFolder(transaction, ownerId, folderId);
      const descendants = await getDescendantFolders(transaction, ownerId, folderId);
      const folderIds = [folderId, ...descendants.map((folder) => folder.id)];

      return transaction.folder.deleteMany({
        where: { id: { in: folderIds }, ownerId },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
