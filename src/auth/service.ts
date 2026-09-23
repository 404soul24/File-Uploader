import type { PrismaClient, User } from '@prisma/client';
import { hash } from 'bcrypt';
import type { RegisterInput } from './validation.js';

export type PublicUser = Pick<User, 'id' | 'email'>;

const passwordHashRounds = 12;

export function toPublicUser(user: User): PublicUser {
  return { id: user.id, email: user.email };
}

export async function registerUser(database: PrismaClient, input: RegisterInput) {
  const passwordHash = await hash(input.password, passwordHashRounds);

  return database.user.create({
    data: {
      email: input.email,
      passwordHash,
    },
    select: {
      id: true,
      email: true,
    },
  });
}
