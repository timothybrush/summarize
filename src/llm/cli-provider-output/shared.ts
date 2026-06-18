export function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function sumNullable(current: number | null, next: number | null): number | null {
  if (typeof next !== "number") return current;
  if (typeof current !== "number") return next;
  return current + next;
}
