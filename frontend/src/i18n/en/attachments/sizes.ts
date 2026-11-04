/** File sizes as `formatBytes` writes them: "512 B", "2 kB", "1.4 MB", "1.9 GB". */
export const sizes = {
  bytes: '{{size}} B',
  kilobytes: '{{size}} kB',
  megabytes: '{{size}} MB',
  gigabytes: '{{size}} GB',
} as const
