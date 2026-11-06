import { Prisma } from "@prisma/client";

const DB_UNAVAILABLE_MARKERS = [
  "Can't reach database server",
  "ECONNREFUSED",
  "Connection refused",
  "Connection is closed",
  "Timed out fetching a new connection",
  "Server has closed the connection",
];

export function isDatabaseUnavailableError(error: unknown): boolean {
  if (
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientRustPanicError
  ) {
    return true;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return ["P1000", "P1001", "P1002", "P1003", "P1017"].includes(error.code);
  }

  if (!(error instanceof Error)) {
    return false;
  }

  return DB_UNAVAILABLE_MARKERS.some((marker) =>
    error.message.includes(marker),
  );
}

export function serviceErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
