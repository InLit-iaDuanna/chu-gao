export type DurationUnit = "hours" | "days";

export function parseDurationHours(
  value: string,
  unit: DurationUnit,
): number | null {
  if (!value.trim()) return null;
  const amount = Number(value);
  const hours = amount * (unit === "days" ? 24 : 1);
  return Number.isInteger(amount) && hours >= 1 && hours <= 720 ? hours : null;
}
