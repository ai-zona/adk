/**
 * Lazy proxy for `@aizona/db`.
 *
 * The real Prisma client lives in the AIZona platform monorepo and is not
 * published to npm. By proxying access we let consumers `import` this
 * package without pulling in a database dependency they may not need.
 * Database-backed features (audit, server registry, grants, tool catalog,
 * health monitor) throw a clear error at first use if `@aizona/db` is not
 * resolvable.
 */

import { createRequire } from "node:module";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _db: any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadDb(): any {
  if (_db) return _db;
  try {
    const req = createRequire(import.meta.url);
    _db = req("@aizona/db").db;
  } catch {
    throw new Error(
      "@aizona/db is not installed. Database-backed features of @aizonaai/mcp-bridge " +
        "(server registry, tool catalog, grants, audit, health monitor) require the " +
        "@aizona/db peer dependency to be available in your application.",
    );
  }
  return _db;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db: any = new Proxy(
  {},
  {
    get(_target, prop) {
      const real = loadDb();
      return real[prop as string];
    },
    has(_target, prop) {
      const real = loadDb();
      return prop in real;
    },
  },
);
