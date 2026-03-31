export function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr + (dateStr.endsWith('Z') ? '' : 'Z')).getTime();
  const seconds = Math.floor((now - then) / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatDuration(startStr: string, endStr?: string | null): string {
  const start = new Date(startStr + (startStr.endsWith('Z') ? '' : 'Z')).getTime();
  const end = endStr
    ? new Date(endStr + (endStr.endsWith('Z') ? '' : 'Z')).getTime()
    : Date.now();
  const seconds = Math.floor((end - start) / 1000);

  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainSec = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainSec}s`;
  const hours = Math.floor(minutes / 60);
  const remainMin = minutes % 60;
  return `${hours}h ${remainMin}m`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function shortenModel(model: string | null): string {
  if (!model) return '—';
  return model
    .replace('claude-', '')
    .replace(/-\d{8}$/, '');
}

export const STATUS_COLORS: Record<string, string> = {
  starting: 'var(--accent-blue)',
  active: 'var(--accent-green)',
  waiting: 'var(--accent-yellow)',
  idle: 'var(--accent-orange)',
  ended: 'var(--accent-gray)',
  error: 'var(--accent-red)',
};
