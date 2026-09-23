import type { PrismaClient } from '@prisma/client';
import { vi } from 'vitest';

export interface TestUser {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

interface FindUniqueArgs {
  where: { email?: string; id?: string };
}

interface CreateArgs {
  data: { email: string; passwordHash: string };
}

export function createTestDatabase(initialUsers: TestUser[] = []) {
  const users = [...initialUsers];
  const findUnique = vi.fn(async ({ where }: FindUniqueArgs) => {
    const user = users.find((candidate) =>
      where.id === undefined ? candidate.email === where.email : candidate.id === where.id,
    );
    return user ?? null;
  });
  const create = vi.fn(async ({ data }: CreateArgs) => {
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
  const database = {
    user: {
      create,
      findUnique,
    },
  } as unknown as PrismaClient;

  return { create, database, findUnique, users };
}
