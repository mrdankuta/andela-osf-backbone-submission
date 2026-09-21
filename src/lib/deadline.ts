export function daysLeft(deadline?: number): number | null {
  if (deadline === undefined) return null;
  return Math.ceil((deadline - Date.now()) / 86400000);
}

export function deadlineLabel(deadline?: number): string {
  const n = daysLeft(deadline);
  if (n === null) return "No deadline published";
  if (n <= 0) return "Closed";
  return `${n}d left`;
}

export function deadlineDateLabel(deadline?: number): string {
  if (deadline === undefined) return "No deadline published";
  return new Date(deadline).toLocaleDateString();
}

export function deadlineSortValue(deadline?: number): number {
  return deadline ?? Number.MAX_SAFE_INTEGER;
}
