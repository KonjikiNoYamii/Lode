import { useState } from "react";
import { get, send } from "@/api";
import type { FileRevision } from "@/types";
import { History, RotateCcw } from "lucide-react";

interface Props {
  conversationId: number | null;
  hasFolder: boolean;
  revisions: FileRevision[];
  onRevisionsUpdated: (revisions: FileRevision[]) => void;
}

interface DiffState {
  id: number;
  diff: string;
  added: number;
  removed: number;
  truncated: boolean;
}

function timeLabel(value: string): string {
  const then = Date.parse(`${value.replace(" ", "T")}Z`);
  if (Number.isNaN(then)) return "";
  const mins = Math.round((Date.now() - then) / 60_000);
  if (mins < 1) return "baru saja";
  if (mins < 60) return `${mins} menit lalu`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} jam lalu`;
  return `${Math.round(hours / 24)} hari lalu`;
}

export default function FileHistoryPanel({
  conversationId,
  hasFolder,
  revisions,
  onRevisionsUpdated,
}: Props) {
  const [diff, setDiff] = useState<DiffState | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState("");

  if (!hasFolder) return null;

  const showDiff = async (rev: FileRevision) => {
    setBusy(rev.id);
    setError("");
    try {
      const r = await get<DiffState & { truncated: boolean }>(
        `/api/revisions/${rev.id}/diff`,
      );
      setDiff({ id: rev.id, diff: r.diff, added: r.added, removed: r.removed, truncated: r.truncated });
    } catch {
      setError("Gagal menghitung diff.");
    } finally {
      setBusy(null);
    }
  };

  const restore = async (rev: FileRevision) => {
    setBusy(rev.id);
    setError("");
    try {
      const r = await send<{ revisions: FileRevision[] }>(
        `/api/revisions/${rev.id}/restore`,
        "POST",
      );
      onRevisionsUpdated(r.revisions);
      setDiff(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal mengembalikan file.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section>
      <div className="mb-2.5 flex items-center justify-between px-1">
        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-mew">
          <History className="h-3.5 w-3.5 text-mew" />
          <span>Riwayat File</span>
        </div>
        {revisions.length > 0 && (
          <span className="text-[10px] font-medium text-mist/60">
            {revisions.length} perubahan
          </span>
        )}
      </div>

      {revisions.length === 0 && (
        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4 text-center text-xs text-mist/70">
          Belum ada file yang ditulis Lode. Setiap perubahan file akan disimpan
          di sini dan bisa dikembalikan.
        </div>
      )}

      {revisions.length > 0 && (
        <ul className="space-y-2">
          {revisions.map((rev) => (
            <li
              key={rev.id}
              className="rounded-xl border border-white/10 bg-panel2/60 p-3 shadow-sm"
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold break-all text-night">
                    {rev.rel}
                  </p>
                  <p className="mt-0.5 text-[10px] text-mist/70">
                    {rev.existed ? "diubah" : "dibuat"} ·{" "}
                    <span className="text-mew">+{rev.added}</span>{" "}
                    <span className="text-sakura">−{rev.removed}</span> baris ·{" "}
                    {timeLabel(rev.created_at)}
                    {rev.source === "undo" && " · undo"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => showDiff(rev)}
                    disabled={busy === rev.id}
                    className="rounded-full border border-white/10 px-2 py-0.5 text-[9px] font-bold text-mist transition hover:border-mew/40 hover:text-mew disabled:opacity-40"
                  >
                    Diff
                  </button>
                  <button
                    onClick={() => restore(rev)}
                    disabled={busy === rev.id}
                    title="Kembalikan isi file ke versi ini"
                    aria-label={`Kembalikan ${rev.rel}`}
                    className="rounded-full border border-white/10 px-1.5 py-0.5 text-mist transition hover:border-mew/40 hover:text-mew disabled:opacity-40"
                  >
                    <RotateCcw className="h-3 w-3" />
                  </button>
                </div>
              </div>

              {diff?.id === rev.id && (
                <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-night/70 p-2 text-[10px] leading-relaxed text-mist">
                  {diff.diff || "(tidak ada perubahan)"}
                </pre>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="mt-2 text-[10px] text-rose-300">{error}</p>
      )}
    </section>
  );
}
