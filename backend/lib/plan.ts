import type { PlanItem, PlanStatus } from "./db";

const PLAN_STATUSES = new Set<PlanStatus>(["todo", "learning", "done", "stuck"]);

export function buildPlanContext(items: PlanItem[]): string {
  if (items.length === 0) return "";
  const byPhase = new Map<number, PlanItem[]>();
  for (const item of items) {
    const bucket = byPhase.get(item.phase);
    if (bucket) bucket.push(item);
    else byPhase.set(item.phase, [item]);
  }
  const lines: string[] = [];
  for (const phase of [...byPhase.keys()].sort((a, b) => a - b)) {
    const bucket = byPhase.get(phase) ?? [];
    const done = bucket.filter((i) => i.status === "done").length;
    lines.push(`Fase ${phase} — ${done}/${bucket.length} selesai`);
    for (const item of bucket) {
      const detail = [
        item.objective ? `target: ${item.objective}` : "",
        item.prerequisites ? `butuh lebih dulu: ${item.prerequisites}` : "",
      ]
        .filter(Boolean)
        .join("; ");
      lines.push(
        `  - [id=${item.id}] [${item.status}] ${item.title}${detail ? ` — ${detail}` : ""}`,
      );
    }
  }
  return lines.join("\n");
}

export function parsePlanMarkers(text: string): {
  updates: { id: number; status: PlanStatus }[];
  clean: string;
} {
  const sink = new Map<number, PlanStatus>();
  const clean = stripPlanMarkers(text, sink);
  return {
    updates: [...sink.entries()].map(([id, status]) => ({ id, status })),
    clean,
  };
}

export function stripPlanMarkers(
  text: string,
  sink?: Map<number, PlanStatus>,
): string {
  return text.replace(
    /@@plan\(\s*(\d+)\s*,\s*"([a-z]+)"\s*\)/gi,
    (match, rawId: string, rawStatus: string) => {
      const id = Number(rawId);
      const status = rawStatus.toLowerCase() as PlanStatus;
      if (!Number.isSafeInteger(id) || id <= 0 || !PLAN_STATUSES.has(status)) {
        return match;
      }
      if (sink) sink.set(id, status);
      return "";
    },
  );
}
