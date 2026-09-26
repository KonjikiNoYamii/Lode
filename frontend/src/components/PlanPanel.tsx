import { useState } from "react";
import { send } from "@/api";
import type { PlanItem, PlanStatus } from "@/types";
import { ListChecks, Plus, X } from "lucide-react";
import { PLAN_STATUS_META } from "./status";

interface Props {
  conversationId: number | null;
  plan: PlanItem[];
  onPlanUpdated: (plan: PlanItem[]) => void;
}

const STATUSES: PlanStatus[] = ["todo", "learning", "done", "stuck"];

function groupByPhase(plan: PlanItem[]): { phase: number; items: PlanItem[] }[] {
  const map = new Map<number, PlanItem[]>();
  for (const item of plan) {
    const bucket = map.get(item.phase);
    if (bucket) bucket.push(item);
    else map.set(item.phase, [item]);
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([phase, items]) => ({ phase, items }));
}

export default function PlanPanel({ conversationId, plan, onPlanUpdated }: Props) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [phase, setPhase] = useState("1");

  const grouped = groupByPhase(plan);
  const doneCount = plan.filter((i) => i.status === "done").length;

  const run = async (fn: () => Promise<{ plan: PlanItem[] }>) => {
    if (!conversationId) return;
    try {
      const r = await fn();
      onPlanUpdated(r.plan);
    } catch {
      return;
    }
  };

  const submit = async () => {
    const clean = title.trim();
    if (!clean || !conversationId) return;
    const body = {
      conversationId,
      title: clean,
      objective: objective.trim(),
      phase: Number(phase) || 1,
    };
    setTitle("");
    setObjective("");
    setAdding(false);
    await run(() => send("/api/plan", "POST", body));
  };

  return (
    <section>
      <div className="mb-2.5 flex items-center justify-between px-1">
        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-mew">
          <ListChecks className="h-3.5 w-3.5 text-mew" />
          <span>Rencana Belajar</span>
        </div>
        {plan.length > 0 && (
          <span className="text-[10px] font-medium text-mist/60">
            {doneCount}/{plan.length} selesai
          </span>
        )}
      </div>

      {plan.length === 0 && !adding && (
        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4 text-center text-xs text-mist/70">
          Belum ada rencana belajar. Minta Lode menyusun rencana, atau tambahkan
          sendiri di bawah.
        </div>
      )}

      {grouped.map(({ phase: ph, items }) => {
        const done = items.filter((i) => i.status === "done").length;
        return (
          <div key={ph} className="mb-2.5">
            <div className="mb-1.5 px-1 text-[10px] font-bold uppercase tracking-wider text-mist/70">
              Fase {ph} · {done}/{items.length}
            </div>
            <ul className="space-y-2">
              {items.map((item) => {
                const meta = PLAN_STATUS_META[item.status];
                return (
                  <li
                    key={item.id}
                    className="rounded-xl border border-white/10 bg-panel2/60 p-3 shadow-sm transition hover:border-white/20"
                  >
                    <div className="flex items-start gap-2">
                      <span
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${meta.dot}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p
                          className={`text-xs font-bold break-words ${
                            item.status === "done"
                              ? "text-mist line-through"
                              : "text-night"
                          }`}
                        >
                          {item.title}
                        </p>
                        {item.objective && (
                          <p className="mt-1 text-[11px] leading-relaxed text-mist/90 break-words">
                            {item.objective}
                          </p>
                        )}
                        {item.prerequisites && (
                          <p className="mt-1 text-[10px] text-mist/60 break-words">
                            Butuh: {item.prerequisites}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() =>
                          run(() => send(`/api/plan/${item.id}`, "DELETE"))
                        }
                        className="shrink-0 rounded-full px-1 text-xs text-mist transition hover:text-sakura"
                        aria-label="Hapus item rencana"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="mt-2 flex items-center gap-1.5">
                      <select
                        value={item.status}
                        onChange={(e) =>
                          run(() =>
                            send(`/api/plan/${item.id}`, "PATCH", {
                              status: e.target.value,
                            }),
                          )
                        }
                        aria-label={`Status item ${item.title}`}
                        className={`cursor-pointer rounded-full border px-2 py-0.5 text-[9px] font-bold ${meta.chip} bg-transparent`}
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s} className="bg-panel text-night">
                            {PLAN_STATUS_META[s].label}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() =>
                          run(() =>
                            send("/api/plan/move", "POST", {
                              conversationId,
                              id: item.id,
                              dir: "up",
                            }),
                          )
                        }
                        className="rounded-full border border-white/10 px-1.5 text-[9px] text-mist transition hover:border-mew/40 hover:text-mew"
                        aria-label="Naikkan urutan item"
                      >
                        ▲
                      </button>
                      <button
                        onClick={() =>
                          run(() =>
                            send("/api/plan/move", "POST", {
                              conversationId,
                              id: item.id,
                              dir: "down",
                            }),
                          )
                        }
                        className="rounded-full border border-white/10 px-1.5 text-[9px] text-mist transition hover:border-mew/40 hover:text-mew"
                        aria-label="Turunkan urutan item"
                      >
                        ▼
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}

      {adding ? (
        <div className="space-y-2 rounded-xl border border-mew/25 bg-mew/5 p-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Judul item, mis. Mengenal variabel pointer"
            maxLength={200}
            className="w-full rounded-lg border border-white/10 bg-night/40 px-2.5 py-1.5 text-xs text-night placeholder:text-mist/50"
          />
          <input
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            placeholder="Target/Control (opsional)"
            maxLength={500}
            className="w-full rounded-lg border border-white/10 bg-night/40 px-2.5 py-1.5 text-xs text-night placeholder:text-mist/50"
          />
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-bold text-mist">Fase</label>
            <input
              type="number"
              min={1}
              max={99}
              value={phase}
              onChange={(e) => setPhase(e.target.value)}
              className="w-16 rounded-lg border border-white/10 bg-night/40 px-2 py-1 text-xs text-night"
            />
            <div className="flex-1" />
            <button
              onClick={() => setAdding(false)}
              className="rounded-lg border border-white/10 px-2.5 py-1 text-[10px] font-bold text-mist"
            >
              Batal
            </button>
            <button
              onClick={submit}
              disabled={!title.trim()}
              className="rounded-lg border border-mew/40 bg-mew/15 px-2.5 py-1 text-[10px] font-bold text-mew disabled:opacity-40"
            >
              Simpan
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          disabled={!conversationId}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/15 py-2 text-[10px] font-bold text-mist transition hover:border-mew/40 hover:text-mew disabled:opacity-40"
        >
          <Plus className="h-3 w-3" /> Tambah item rencana
        </button>
      )}
    </section>
  );
}
