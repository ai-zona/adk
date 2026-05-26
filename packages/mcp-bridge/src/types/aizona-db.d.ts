// Stub type declaration for @aizona/db
// The real package lives in the main AIZona v2 platform repo.
declare module '@aizona/db' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface QueryOptions {
    where?: any;
    select?: any;
    include?: any;
    data?: any;
    orderBy?: any;
    take?: number;
    skip?: number;
    [key: string]: any;
  }

  interface DbDelegate {
    findFirst: (opts?: QueryOptions) => Promise<any>;
    findUnique: (opts?: QueryOptions) => Promise<any>;
    findUniqueOrThrow: (opts?: QueryOptions) => Promise<any>;
    findMany: (opts?: QueryOptions) => Promise<any[]>;
    create: (opts?: QueryOptions) => Promise<any>;
    update: (opts?: QueryOptions) => Promise<any>;
    updateMany: (opts?: QueryOptions) => Promise<any>;
    upsert: (opts?: QueryOptions) => Promise<any>;
    delete: (opts?: QueryOptions) => Promise<any>;
    count: (opts?: QueryOptions) => Promise<number>;
    [key: string]: (...args: any[]) => Promise<any>;
  }

  interface DbClient {
    $queryRawUnsafe<T = unknown>(...args: unknown[]): Promise<T>;
    $executeRawUnsafe(...args: unknown[]): Promise<number>;
    [key: string]: DbDelegate | ((...args: unknown[]) => unknown);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const db: DbClient & { [key: string]: any };
}
