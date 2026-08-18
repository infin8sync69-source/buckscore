/**
 * Lightweight RFC-4122-ish v4 UUID generator (not cryptographically secure —
 * used only for request-correlation IDs, not key material).
 *
 * Previously reimplemented identically in inpage/index.ts and content/index.ts —
 * consolidated here with no change in behavior or output.
 */
export function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
