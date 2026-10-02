import { useState } from "react";
import { send } from "@/api";
import type { CardRating, ReviewCard } from "@/types";
import { MAX_CARD_BOX } from "@/types";
import { Brain, Plus, Trash2, X } from "lucide-react";

interface Props {
  conversationId: number | null;
  cards: ReviewCard[];
  onCardsUpdated: (cards: ReviewCard[]) => void;
}

const RATINGS: { value: CardRating; label: string; chip: string }[] = [
  { value: "lupa", label: "Lupa", chip: "border-rose-500/40 text-rose-300 hover:bg-rose-500/15" },
  { value: "nyaris", label: "Nyaris", chip: "border-amber-500/40 text-amber-300 hover:bg-amber-500/15" },
  { value: "ingat", label: "Ingat", chip: "border-mew/40 text-mew hover:bg-mew/15" },
];

function isDue(card: ReviewCard): boolean {
  return card.due_at <= new Date().toISOString().slice(0, 19).replace("T", " ");
}

function dueLabel(dueAt: string): string {
  const diff = Date.parse(`${dueAt.replace(" ", "T")}Z`) - Date.now();
  const days = Math.round(diff / 86_400_000);
  if (Number.isNaN(diff)) return "";
  if (days <= 0) return "jatuh tempo";
  if (days === 1) return "besok";
  return `${days} hari lagi`;
}

export default function ReviewPanel({ conversationId, cards, onCardsUpdated }: Props) {
  const [adding, setAdding] = useState(false);
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [revealed, setRevealed] = useState<Set<number>>(new Set());

  const due = cards.filter(isDue);
  const upcoming = cards.filter((c) => !isDue(c));

  const run = async (fn: () => Promise<{ cards: ReviewCard[] }>) => {
    if (!conversationId) return;
    try {
      const r = await fn();
      onCardsUpdated(r.cards);
    } catch {
      return;
    }
  };

  const rate = (id: number, rating: CardRating) =>
    run(() => send(`/api/cards/${id}`, "PATCH", { rating }));

  const submit = async () => {
    const clean = front.trim();
    if (!clean || !conversationId) return;
    setFront("");
    setBack("");
    setAdding(false);
    await run(() =>
      send("/api/cards", "POST", {
        conversationId,
        front: clean,
        back: back.trim(),
      }),
    );
  };

  const renderCard = (card: ReviewCard, isDueCard: boolean) => {
    const open = revealed.has(card.id);
    return (
      <li
        key={card.id}
        className={`rounded-xl border p-3 shadow-sm transition ${
          isDueCard
            ? "border-mew/25 bg-mew/[0.04]"
            : "border-white/10 bg-panel2/60 hover:border-white/20"
        }`}
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold break-words text-night">{card.front}</p>
            {open && card.back && (
              <p className="mt-1.5 rounded-lg bg-night/40 px-2 py-1.5 text-[11px] leading-relaxed text-mist break-words">
                {card.back}
              </p>
            )}
          </div>
          <button
            onClick={() =>
              run(() => send(`/api/cards/${card.id}`, "DELETE"))
            }
            className="shrink-0 rounded-full px-1 text-xs text-mist transition hover:text-sakura"
            aria-label="Hapus kartu"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          {card.back && (
            <button
              onClick={() =>
                setRevealed((prev) => {
                  const next = new Set(prev);
                  if (next.has(card.id)) next.delete(card.id);
                  else next.add(card.id);
                  return next;
                })
              }
              className="rounded-full border border-white/10 px-2 py-0.5 text-[9px] font-bold text-mist transition hover:border-mew/40 hover:text-mew"
            >
              {open ? "Sembunyikan" : "Lihat jawaban"}
            </button>
          )}
          {isDueCard &&
            RATINGS.map((r) => (
              <button
                key={r.value}
                onClick={() => rate(card.id, r.value)}
                className={`rounded-full border px-2 py-0.5 text-[9px] font-bold transition ${r.chip}`}
              >
                {r.label}
              </button>
            ))}
          <span className="ml-auto rounded-full border border-white/10 px-2 py-0.5 text-[9px] font-medium text-mist/70">
            {isDueCard ? "jatuh tempo" : dueLabel(card.due_at)} · kotak {card.box}/
            {MAX_CARD_BOX}
          </span>
        </div>
      </li>
    );
  };

  return (
    <section>
      <div className="mb-2.5 flex items-center justify-between px-1">
        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-mew">
          <Brain className="h-3.5 w-3.5 text-mew" />
          <span>Kartu Review</span>
        </div>
        {cards.length > 0 && (
          <span className="text-[10px] font-medium text-mist/60">
            {due.length}/{cards.length} jatuh tempo
          </span>
        )}
      </div>

      {cards.length === 0 && !adding && (
        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4 text-center text-xs text-mist/70">
          Belum ada kartu review. Kartu dibuat otomatis dari topik yang sudah
          punya bukti belajar, atau tambahkan sendiri di bawah.
        </div>
      )}

      {due.length > 0 && (
        <ul className="mb-2.5 space-y-2">{due.map((c) => renderCard(c, true))}</ul>
      )}

      {upcoming.length > 0 && (
        <>
          <div className="mb-1.5 px-1 text-[10px] font-bold uppercase tracking-wider text-mist/70">
            Terjadwal
          </div>
          <ul className="space-y-2">{upcoming.map((c) => renderCard(c, false))}</ul>
        </>
      )}

      {adding ? (
        <div className="mt-2 space-y-2 rounded-xl border border-mew/25 bg-mew/5 p-3">
          <input
            value={front}
            onChange={(e) => setFront(e.target.value)}
            placeholder="Pertanyaan, mis. Apa itu pointer?"
            maxLength={200}
            className="w-full rounded-lg border border-white/10 bg-night/40 px-2.5 py-1.5 text-xs text-night placeholder:text-mist/50"
          />
          <input
            value={back}
            onChange={(e) => setBack(e.target.value)}
            placeholder="Jawaban singkat (opsional)"
            maxLength={500}
            className="w-full rounded-lg border border-white/10 bg-night/40 px-2.5 py-1.5 text-xs text-night placeholder:text-mist/50"
          />
          <div className="flex items-center gap-2">
            <div className="flex-1" />
            <button
              onClick={() => setAdding(false)}
              className="rounded-lg border border-white/10 px-2.5 py-1 text-[10px] font-bold text-mist"
            >
              Batal
            </button>
            <button
              onClick={submit}
              disabled={!front.trim()}
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
          {adding ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />} Tambah
          kartu
        </button>
      )}
    </section>
  );
}
