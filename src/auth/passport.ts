import type { PrismaClient } from '@prisma/client';
import { compare, hash } from 'bcrypt';
import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';

const passwordHashRounds = 12;
const dummyPasswordHash = hash('not-a-real-user-password', passwordHashRounds);

export function createPassport(database: PrismaClient) {
  const authenticator = new passport.Authenticator();

  authenticator.serializeUser((user, done) => {
    done(null, user.id);
  });

  authenticator.deserializeUser<string>((id, done) => {
    void database.user
      .findUnique({
        where: { id },
        select: { id: true, email: true },
      })
      .then((user) => done(null, user))
      .catch((error: unknown) => done(error));
  });

  authenticator.use(
    new LocalStrategy(
      { usernameField: 'email', passwordField: 'password', session: false },
      (email, password, done) => {
        void (async () => {
          const normalizedEmail = email.trim().toLowerCase();
          const user = await database.user.findUnique({
            where: { email: normalizedEmail },
          });
          const passwordHash = user?.passwordHash ?? (await dummyPasswordHash);
          const passwordMatches = await compare(password, passwordHash);

          if (!user || !passwordMatches) {
            done(null, false);
            return;
          }

          done(null, user);
        })().catch((error: unknown) => done(error));
      },
    ),
  );

  return authenticator;
}
