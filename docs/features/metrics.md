# Prometheus Metrics

SoftTrack exposes Prometheus metrics at `/metrics` only when `METRICS_TOKEN`
is set. With the default blank value, the endpoint returns `404` so metrics are
not accidentally published.

Set a high-entropy token in the backend environment:

```env
METRICS_TOKEN=replace-with-a-long-random-token
```

Example Prometheus scrape config:

```yaml
scrape_configs:
  - job_name: softtrack
    metrics_path: /metrics
    scheme: https
    static_configs:
      - targets:
          - softtrack.example.com
    authorization:
      type: Bearer
      credentials: replace-with-a-long-random-token
```

The HTTP metrics use the FastAPI route template as the `route` label, such as
`/issues/{issue_id}`, rather than the raw request path. This keeps per-issue
IDs out of the label set.
