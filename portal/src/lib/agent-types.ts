export type DebugSeriesRow = {
  device?: string;
  series?: string;
  points?: number;
  first_ts?: string;
  last_ts?: string;
  [key: string]: unknown;
};

export type DebugPayload = {
  inputs?: Record<string, unknown>;
  resolved_range?: Record<string, unknown>;
  query_proof?: {
    sha256?: string;
    snippet?: string;
    [key: string]: unknown;
  };
  stats?: {
    total_series?: number;
    total_points?: number;
    series?: DebugSeriesRow[];
    [key: string]: unknown;
  };
  sample_rows?: Record<string, Array<{ ts?: string; value?: unknown; [key: string]: unknown }>>;
  timings_ms?: Record<string, number>;
  warnings?: string[];
  [key: string]: unknown;
};
