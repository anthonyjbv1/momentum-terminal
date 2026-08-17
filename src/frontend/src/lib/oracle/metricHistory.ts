/**
 * metricHistory.ts
 *
 * Persistent metric snapshot system for week-over-week and month-over-month
 * delta headline generation across live Oracle data sources.
 */

export interface MetricSnapshot {
  key: string;
  value: number;
  label: string;
  source: string;
  timestamp: string;
  date: string;
}

interface DeltaHeadline {
  text: string;
  sourceTier: 2;
  forcedIndex: string;
  source: string;
  sentimentScore: number;
  sourceLabelOverride: true;
}

const HISTORY_KEY = "mt_metric_history";
const MAX_ENTRIES = 500;

export function saveMetricSnapshot(
  key: string,
  value: number,
  label: string,
  source: string,
): void {
  try {
    const existing: MetricSnapshot[] = JSON.parse(
      localStorage.getItem(HISTORY_KEY) ?? "[]",
    );
    const now = new Date();
    existing.push({
      key,
      value,
      label,
      source,
      timestamp: now.toISOString(),
      date: now.toISOString().slice(0, 10),
    });
    if (existing.length > MAX_ENTRIES) {
      existing.splice(0, existing.length - MAX_ENTRIES);
    }
    localStorage.setItem(HISTORY_KEY, JSON.stringify(existing));
  } catch {
    /* ignore */
  }
}

export function getDeltaHeadlines(
  key: string,
  currentValue: number,
  entityName: string,
  sourceLabel: string,
  targetIndex: string,
): DeltaHeadline[] {
  const headlines: DeltaHeadline[] = [];
  try {
    const history: MetricSnapshot[] = JSON.parse(
      localStorage.getItem(HISTORY_KEY) ?? "[]",
    );
    const entries = history.filter((e) => e.key === key);
    const now = Date.now();
    const sourceKey = sourceLabel.split(" ")[0].toLowerCase();

    const weeklyEntry = entries
      .slice()
      .reverse()
      .find((e) => {
        const ageDays = (now - new Date(e.timestamp).getTime()) / 86_400_000;
        return ageDays >= 5 && ageDays <= 9;
      });

    if (weeklyEntry && weeklyEntry.value !== 0) {
      const delta = currentValue - weeklyEntry.value;
      const pct = (delta / weeklyEntry.value) * 100;
      if (Math.abs(pct) >= 0.25) {
        const direction = delta >= 0 ? "grew" : "declined";
        headlines.push({
          text: `${entityName} ${sourceLabel} ${direction} by ${Math.abs(delta).toFixed(2)} week over week (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%)`,
          sourceTier: 2,
          source: sourceKey,
          forcedIndex: targetIndex,
          sourceLabelOverride: true,
          sentimentScore: delta >= 0 ? 0.82 : -0.82,
        });
      }
    }

    const monthlyEntry = entries
      .slice()
      .reverse()
      .find((e) => {
        const ageDays = (now - new Date(e.timestamp).getTime()) / 86_400_000;
        return ageDays >= 25 && ageDays <= 35;
      });

    if (monthlyEntry && monthlyEntry.value !== 0) {
      const delta = currentValue - monthlyEntry.value;
      const pct = (delta / monthlyEntry.value) * 100;
      if (Math.abs(pct) >= 1.0) {
        const direction = delta >= 0 ? "grew" : "declined";
        headlines.push({
          text: `${entityName} ${sourceLabel} ${direction} by ${Math.abs(delta).toFixed(2)} month over month (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%)`,
          sourceTier: 2,
          source: sourceKey,
          forcedIndex: targetIndex,
          sourceLabelOverride: true,
          sentimentScore: delta >= 0 ? 0.82 : -0.82,
        });
      }
    }
  } catch {
    /* ignore */
  }
  return headlines;
}
