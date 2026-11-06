import {
  ProviderContentRejectedError,
  ProviderRejectedRequestError,
  classifyProviderFailure,
} from "@/lib/providers/diagnostics";

export function isDowngradable(error: unknown): boolean {
  const { category } = classifyProviderFailure(error);

  return category === "RATE_LIMITED" || category === "TRANSIENT_PROVIDER";
}

export function isAuthenticationError(error: unknown): boolean {
  return classifyProviderFailure(error).category === "AUTH_ACCOUNT_FATAL";
}

export function isFatalAccountError(error: unknown): boolean {
  return isAuthenticationError(error);
}

export function isRateLimited(error: unknown): boolean {
  return classifyProviderFailure(error).category === "RATE_LIMITED";
}

export function shouldRecordProviderPoolError(error: unknown): boolean {
  const { category } = classifyProviderFailure(error);

  return (
    category === "RATE_LIMITED" ||
    category === "TRANSIENT_PROVIDER" ||
    category === "AUTH_ACCOUNT_FATAL"
  );
}

export function providerRejectedError(error: unknown): Error | null {
  const { category } = classifyProviderFailure(error);

  if (category === "CONTENT_REJECTED") {
    return new ProviderContentRejectedError(error);
  }

  if (category === "BAD_REQUEST") {
    return new ProviderRejectedRequestError(error);
  }

  return null;
}
