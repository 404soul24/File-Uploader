const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

export function formatBytes(bytes: bigint) {
  if (bytes < 1_024n) {
    return `${bytes} B`;
  }

  let value = Number(bytes);
  let unitIndex = 0;

  while (value >= 1_024 && unitIndex < units.length - 1) {
    value /= 1_024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}
