import type { Prisma, PrismaClient } from '@prisma/client';
import { vi } from 'vitest';

export interface TestUser {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TestFile {
  id: string;
  originalName: string;
  storageKey: string;
  downloadUrl: string;
  mimeType: string;
  byteSize: bigint;
  uploadedAt: Date;
  ownerId: string;
  folderId: string | null;
}

export interface TestFolderShare {
  id: string;
  tokenHash: string;
  durationDays: number;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  folderId: string;
  createdById: string;
}

export interface TestFolder {
  id: string;
  name: string;
  ownerId: string;
  parentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface FindUniqueArgs {
  where: { email?: string; id?: string };
}

interface CreateUserArgs {
  data: { email: string; passwordHash: string };
}

interface FolderWhere {
  ownerId: string;
  id?: string;
  parentId?: string | null | { in: string[] };
  name?: { equals: string; mode?: 'insensitive' };
}

interface FileWhere {
  id: string;
  ownerId: string;
  folderId?: string | null | { not: null };
}

interface CreateFileArgs {
  data: {
    id: string;
    originalName: string;
    storageKey: string;
    downloadUrl: string;
    mimeType: string;
    byteSize: bigint;
    ownerId: string;
    folderId: string | null;
  };
}

interface FindFirstFileArgs {
  where: FileWhere;
}

interface FindManyFileArgs {
  where: Omit<FileWhere, 'id'>;
  orderBy?: { uploadedAt?: 'desc' };
}

interface FindManyFolderArgs {
  where: FolderWhere;
  orderBy?: { name?: 'asc'; createdAt?: 'asc' };
}

interface FindFirstFolderArgs {
  where: FolderWhere;
}

interface CreateFolderArgs {
  data: { name: string; ownerId: string; parentId: string | null };
}

interface UpdateFolderArgs {
  where: { id: string };
  data: { name: string };
}

function matchesFolder(folder: TestFolder, where: FolderWhere) {
  if (folder.ownerId !== where.ownerId) {
    return false;
  }

  if (where.id !== undefined && folder.id !== where.id) {
    return false;
  }

  if (where.parentId !== undefined) {
    if (where.parentId !== null && typeof where.parentId === 'object') {
      if (!where.parentId.in.includes(folder.parentId ?? '')) {
        return false;
      }
    } else if (folder.parentId !== where.parentId) {
      return false;
    }
  }

  if (where.name !== undefined && folder.name.toLowerCase() !== where.name.equals.toLowerCase()) {
    return false;
  }

  return true;
}

function matchesFile(
  file: TestFile,
  where: { id?: string; ownerId: string; folderId?: string | null | { not: null } },
) {
  if (where.id !== undefined && file.id !== where.id) {
    return false;
  }

  if (file.ownerId !== where.ownerId) {
    return false;
  }

  if (where.folderId === undefined) {
    return true;
  }

  if (where.folderId !== null && typeof where.folderId === 'object') {
    return file.folderId !== where.folderId.not;
  }

  return file.folderId === where.folderId;
}

export function createTestDatabase(
  initialUsers: TestUser[] = [],
  initialFolders: TestFolder[] = [],
  initialFiles: TestFile[] = [],
  initialShares: TestFolderShare[] = [],
) {
  const users = [...initialUsers];
  const folders = [...initialFolders];
  const files = [...initialFiles];
  const shares = [...initialShares];
  let shareCounter = shares.length;
  let folderCounter = 0;
  const findUnique = vi.fn(async ({ where }: FindUniqueArgs) => {
    const user = users.find((candidate) =>
      where.id === undefined ? candidate.email === where.email : candidate.id === where.id,
    );
    return user ?? null;
  });
  const createUser = vi.fn(async ({ data }: CreateUserArgs) => {
    const now = new Date();
    const user: TestUser = {
      id: `user-${users.length + 1}`,
      email: data.email,
      passwordHash: data.passwordHash,
      createdAt: now,
      updatedAt: now,
    };
    users.push(user);
    return user;
  });
  const findFolderFirst = vi.fn(async ({ where }: FindFirstFolderArgs) => {
    return folders.find((folder) => matchesFolder(folder, where)) ?? null;
  });
  const findManyFolders = vi.fn(async ({ where, orderBy }: FindManyFolderArgs) => {
    const matches = folders.filter((folder) => matchesFolder(folder, where));
    return orderBy?.name === 'asc'
      ? matches.sort((left, right) => left.name.localeCompare(right.name))
      : matches;
  });
  const createFolder = vi.fn(async ({ data }: CreateFolderArgs) => {
    folderCounter += 1;
    const now = new Date();
    const folder: TestFolder = {
      id: `folder-${folderCounter}`,
      name: data.name,
      ownerId: data.ownerId,
      parentId: data.parentId,
      createdAt: now,
      updatedAt: now,
    };
    folders.push(folder);
    return folder;
  });
  const updateFolder = vi.fn(async ({ where, data }: UpdateFolderArgs) => {
    const folder = folders.find((candidate) => candidate.id === where.id);
    if (!folder) {
      throw new Error('Folder not found');
    }

    folder.name = data.name;
    folder.updatedAt = new Date();
    return folder;
  });
  const deleteManyFolders = vi.fn(
    async ({ where }: { where: { id: { in: string[] }; ownerId: string } }) => {
      const ids = new Set(where.id.in);
      const remaining = folders.filter(
        (folder) => !(ids.has(folder.id) && folder.ownerId === where.ownerId),
      );
      const count = folders.length - remaining.length;
      folders.length = 0;
      folders.push(...remaining);
      return { count };
    },
  );
  const createFile = vi.fn(async ({ data }: CreateFileArgs) => {
    const file: TestFile = {
      id: data.id,
      originalName: data.originalName,
      storageKey: data.storageKey,
      downloadUrl: data.downloadUrl,
      mimeType: data.mimeType,
      byteSize: data.byteSize,
      uploadedAt: new Date(),
      ownerId: data.ownerId,
      folderId: data.folderId,
    };
    files.push(file);
    return file;
  });
  const findFileFirst = vi.fn(async ({ where }: FindFirstFileArgs) => {
    return files.find((file) => matchesFile(file, where)) ?? null;
  });
  const findManyFiles = vi.fn(async ({ where }: FindManyFileArgs) => {
    const matches = files.filter((file) => matchesFile(file, where));
    return where.folderId === undefined && where.ownerId
      ? matches.sort((left, right) => right.uploadedAt.getTime() - left.uploadedAt.getTime())
      : matches;
  });
  const createFolderShare = vi.fn(
    async ({
      data,
    }: {
      data: Omit<TestFolderShare, 'id' | 'createdAt' | 'updatedAt' | 'revokedAt'>;
    }) => {
      shareCounter += 1;
      const now = new Date();
      const share: TestFolderShare = {
        ...data,
        id: `share-${shareCounter}`,
        createdAt: now,
        updatedAt: now,
        revokedAt: null,
      };
      shares.push(share);
      return share;
    },
  );
  const findFolderShare = vi.fn(
    async ({
      where,
    }: {
      where: { tokenHash: string; revokedAt: null; expiresAt: { gt: Date } };
    }) => {
      const share = shares.find(
        (candidate) =>
          candidate.tokenHash === where.tokenHash &&
          candidate.revokedAt === null &&
          candidate.expiresAt > where.expiresAt.gt,
      );
      if (!share) {
        return null;
      }

      const folder = folders.find((candidate) => candidate.id === share.folderId);
      return folder ? { ...share, folder } : null;
    },
  );
  const findManyFolderShares = vi.fn(async ({ where }: { where: { createdById: string } }) => {
    return shares
      .filter((share) => share.createdById === where.createdById)
      .map((share) => ({
        ...share,
        folder: folders.find((folder) => folder.id === share.folderId),
      }));
  });
  const updateManyFolderShares = vi.fn(
    async ({
      where,
      data,
    }: {
      where: { id: string; createdById: string; revokedAt: null };
      data: { revokedAt: Date };
    }) => {
      const share = shares.find(
        (candidate) =>
          candidate.id === where.id &&
          candidate.createdById === where.createdById &&
          candidate.revokedAt === null,
      );
      if (!share) {
        return { count: 0 };
      }

      share.revokedAt = data.revokedAt;
      share.updatedAt = data.revokedAt;
      return { count: 1 };
    },
  );
  const database = {
    user: {
      create: createUser,
      findUnique,
    },
    folderShare: {
      create: createFolderShare,
      findFirst: findFolderShare,
      findMany: findManyFolderShares,
      updateMany: updateManyFolderShares,
    },
    file: {
      create: createFile,
      findFirst: findFileFirst,
      findMany: findManyFiles,
    },
    folder: {
      create: createFolder,
      deleteMany: deleteManyFolders,
      findFirst: findFolderFirst,
      findMany: findManyFolders,
      update: updateFolder,
    },
  } as unknown as PrismaClient;
  const transaction = async (callback: (client: Prisma.TransactionClient) => Promise<unknown>) =>
    callback(database as unknown as Prisma.TransactionClient);
  (database as unknown as { $transaction: typeof transaction }).$transaction = transaction;

  return {
    create: createUser,
    createFile,
    createFolder,
    createFolderShare,
    database,
    deleteManyFolders,
    findUnique,
    files,
    folders,
    shares,
  };
}
