/**
 * metricHistory.ts
 *
 * Persistent metric snapshot system for daily, week-over-week, and month-over-month
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

// Scales a percent-change into a [-1, 1] sentiment score.
// maxPct defines the move size that earns full weight (±1.0).
function scaleSentiment(pct: number, maxPct: number): number {
  const raw = pct / maxPct;
  return Math.max(-1, Math.min(1, raw));
}

export function getDailyDeltaHeadlines(
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
    const isMacro = /^(fred|bls|bea)\b/i.test(sourceLabel);

    // Jittered daily window: 20-28 hours ago
    const minAge = 20 * 60 * 60 * 1000;
    const maxAge = 28 * 60 * 60 * 1000;

    const dailyEntry = entries
      .slice()
      .reverse()
      .find((e) => {
        const age = now - new Date(e.timestamp).getTime();
        return age >= minAge && age <= maxAge;
      });

    if (dailyEntry && dailyEntry.value !== 0) {
      const delta = currentValue - dailyEntry.value;
      const pct = (delta / dailyEntry.value) * 100;
      if (Math.abs(pct) >= 1.5) {
        const absPct = Math.abs(pct).toFixed(1);
        let text: string;
        if (isMacro) {
          text = pct >= 0
            ? `${entityName} ticked higher overnight — up ${absPct}% day over day`
            : `${entityName} eased overnight — down ${absPct}% from yesterday`;
        } else {
          text = pct >= 0
            ? `${entityName} picked up ${Math.abs(delta).toFixed(2)} overnight — up ${absPct}% from yesterday`
            : `${entityName} pulled back overnight — down ${absPct}% from yesterday's reading`;
        }
        headlines.push({
          text,
          sourceTier: 2,
          source: sourceKey,
          forcedIndex: targetIndex,
          sourceLabelOverride: true,
          sentimentScore: scaleSentiment(pct, 3),
        });
      }
    }
  } catch {
    /* ignore */
  }
  return headlines;
}

export function getDeltaHeadlines(
  key: string,
  currentValue: number,
  entityName: string,
  sourceLabel: string,
  targetIndex: string,
  // maxPct for weekly and monthly — a move of this size earns sentiment ±1.0
  weeklyMaxPct = 5,
  monthlyMaxPct = 10,
): DeltaHeadline[] {
  const headlines: DeltaHeadline[] = [];
  try {
    const history: MetricSnapshot[] = JSON.parse(
      localStorage.getItem(HISTORY_KEY) ?? "[]",
    );
    const entries = history.filter((e) => e.key === key);
    const now = Date.now();
    const sourceKey = sourceLabel.split(" ")[0].toLowerCase();

    // Jittered weekly window: 5-9 days ago
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
        const absPct = Math.abs(pct).toFixed(1);
        let text: string;
        if (Math.abs(pct) >= 5) {
          text = pct >= 0
            ? `${entityName} surged ${absPct}% this week — strongest weekly gain in recent history`
            : `${entityName} dropped ${absPct}% this week — sharpest weekly decline in recent history`;
        } else {
          text = pct >= 0
            ? `${entityName} gained ground this week — up ${absPct}% over the past 7 days`
            : `${entityName} lost momentum this week — down ${absPct}% week over week`;
        }
        headlines.push({
          text,
          sourceTier: 2,
          source: sourceKey,
          forcedIndex: targetIndex,
          sourceLabelOverride: true,
          sentimentScore: scaleSentiment(pct, weeklyMaxPct),
        });
      }
    }

    // Jittered monthly window: 25-35 days ago
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
        const absPct = Math.abs(pct).toFixed(1);
        let text: string;
        if (Math.abs(pct) >= 10) {
          text = pct >= 0
            ? `${entityName} up ${absPct}% month over month — one of the stronger monthly moves on the platform`
            : `${entityName} down ${absPct}% month over month — meaningful trend worth watching`;
        } else {
          text = pct >= 0
            ? `${entityName} climbed ${absPct}% over the past month — sustained upward momentum`
            : `${entityName} declined ${absPct}% over the past month — sustained downward pressure`;
        }
        headlines.push({
          text,
          sourceTier: 2,
          source: sourceKey,
          forcedIndex: targetIndex,
          sourceLabelOverride: true,
          sentimentScore: scaleSentiment(pct, monthlyMaxPct),
        });
      }
    }
  } catch {
    /* ignore */
  }
  return headlines;
}
