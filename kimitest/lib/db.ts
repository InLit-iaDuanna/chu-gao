import { PrismaClient } from "@prisma/client";

declare global {
  var __prisma__: PrismaClient | undefined;
}

export const db =
  globalThis.__prisma__ ??
  new PrismaClient({
    log:
      process.env.PRISMA_LOG_LEVEL === "silent"
        ? []
        : process.env.NODE_ENV === "development"
          ? ["warn", "error"]
          : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma__ = db;
}
