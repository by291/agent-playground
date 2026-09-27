export interface Activity {
  id: string;
  type: string;
  detail?: string;
}

export interface RunSummary {
  runId: string;
  status: string;
}
