const INVALID_REFRESH_BACKOFF_MS = 6 * 60 * 60 * 1000;
const invalidRefreshNotifiedAt = new Map<number, number>();

export function shouldSkipInvalidRefresh(accountId: number, now = Date.now()): boolean {
  const lastInvalidNotice = invalidRefreshNotifiedAt.get(accountId) ?? 0;
  return now - lastInvalidNotice < INVALID_REFRESH_BACKOFF_MS;
}

export function markInvalidRefresh(accountId: number, now = Date.now()): void {
  invalidRefreshNotifiedAt.set(accountId, now);
}

export function clearInvalidRefreshBackoff(accountId: number): void {
  invalidRefreshNotifiedAt.delete(accountId);
}

export function resetInvalidRefreshBackoffForTests(): void {
  invalidRefreshNotifiedAt.clear();
}

export function getInvalidRefreshBackoffMs(): number {
  return INVALID_REFRESH_BACKOFF_MS;
}
