import fs from 'fs';
import path from 'path';

export type FlowStepTiming = {
  step: string;
  durationMs: number;
  durationSec: string;
};

export type FlowPerformanceReport = {
  flow: string;
  savedAt: string;
  totalDurationMs: number;
  totalDurationSec: string;
  steps: FlowStepTiming[];
  orgId?: string;
  orgName?: string;
  tenantEmail?: string;
  tenantName?: string;
  note: string;
};

type PerformanceStore = {
  latest: FlowPerformanceReport | null;
  history: FlowPerformanceReport[];
};

const DATA_DIR = path.join(process.cwd(), 'test-data');
const MAX_HISTORY = 20;

export function formatDurationSec(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = ((ms % 60_000) / 1000).toFixed(0);
  return `${mins}m ${secs}s`;
}

export class FlowPerfTracker {
  private readonly startedAt = Date.now();
  private readonly steps: FlowStepTiming[] = [];

  async step<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const t0 = Date.now();
    try {
      return await fn();
    } finally {
      const durationMs = Date.now() - t0;
      const timing: FlowStepTiming = {
        step: name,
        durationMs,
        durationSec: formatDurationSec(durationMs),
      };
      this.steps.push(timing);
      console.log(`[perf] ${name}: ${timing.durationSec}`);
    }
  }

  buildReport(
    meta: Omit<FlowPerformanceReport, 'savedAt' | 'totalDurationMs' | 'totalDurationSec' | 'steps' | 'note'> & {
      note?: string;
    },
  ): FlowPerformanceReport {
    const totalDurationMs = Date.now() - this.startedAt;
    return {
      ...meta,
      savedAt: new Date().toISOString(),
      totalDurationMs,
      totalDurationSec: formatDurationSec(totalDurationMs),
      steps: [...this.steps],
      note: meta.note ?? 'Includes Playwright slowMo delay if enabled in playwright.config.ts',
    };
  }

  logSummary(report: FlowPerformanceReport): void {
    console.log('');
    console.log(`${report.flow} Performance${report.orgId ? ` — ${report.orgId}` : ''}`);
    console.log('─────────────────────────────────────');
    for (const s of report.steps) {
      const pad = s.step.padEnd(28, ' ');
      console.log(`${pad}: ${s.durationSec}`);
    }
    console.log('─────────────────────────────────────');
    console.log(`Total${' '.repeat(23)}: ${report.totalDurationSec}`);
    console.log('');
  }
}

export function saveFlowPerformance(fileBaseName: string, report: FlowPerformanceReport): string {
  const dataFile = path.join(DATA_DIR, `${fileBaseName}.json`);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  let store: PerformanceStore = { latest: null, history: [] };
  if (fs.existsSync(dataFile)) {
    try {
      store = JSON.parse(fs.readFileSync(dataFile, 'utf-8')) as PerformanceStore;
      if (!Array.isArray(store.history)) store.history = [];
    } catch {
      store = { latest: null, history: [] };
    }
  }
  store.latest = report;
  store.history = [report, ...store.history.filter((r) => r.savedAt !== report.savedAt)].slice(0, MAX_HISTORY);
  fs.writeFileSync(dataFile, JSON.stringify(store, null, 2), 'utf-8');
  console.log(`Performance report saved to ${dataFile}`);
  return dataFile;
}
