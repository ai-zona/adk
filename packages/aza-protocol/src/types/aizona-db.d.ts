// Stub type declaration for @aizona/db
// The real package lives in the main AIZona v2 platform repo.
declare module '@aizona/db' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface DbDelegate {
    findFirst: (...args: any[]) => Promise<any>;
    findUnique: (...args: any[]) => Promise<any>;
    findUniqueOrThrow: (...args: any[]) => Promise<any>;
    findMany: (...args: any[]) => Promise<any[]>;
    create: (...args: any[]) => Promise<any>;
    update: (...args: any[]) => Promise<any>;
    updateMany: (...args: any[]) => Promise<any>;
    upsert: (...args: any[]) => Promise<any>;
    delete: (...args: any[]) => Promise<any>;
    count: (...args: any[]) => Promise<number>;
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
