/** The cumulative flow diagram. Its bands are named by `CATEGORY_META`. */
export const flow = {
  title: 'Cumulative flow',
  note:
    'Issues in each stage, per day. A band that keeps widening is work piling up in that stage.',
  empty: 'No issue history in this window yet.',
  chart: 'Cumulative flow diagram',
} as const
