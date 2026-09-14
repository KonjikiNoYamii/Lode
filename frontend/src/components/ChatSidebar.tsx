import type { Conversation, Profile } from "@/types";
import { Mascot } from "./Mascot";

interface Props {
  open: boolean;
  onClose: () => void;
  profile: Profile | null;
  conversations: Conversation[];
  currentId: number | null;
  onNewChat: () => void;
  onSelect: (id: number) => void;
  onDelete: (id: number) => void;
}

function SectionTitle({ children }: { children: string }) {
  return (
    <h3 className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wider text-mist">
      {children}
    </h3>
  );
}

export default function ChatSidebar({
  open,
  onClose,
  profile,
  conversations,
  currentId,
  onNewChat,
  onSelect,
  onDelete,
}: Props) {
  return (
    <aside
      className={`${
        open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
      } fixed top-0 bottom-0 left-0 z-30 flex w-72 shrink-0 flex-col border-r border-white/10 bg-panel transition-transform lg:static lg:z-auto lg:h-full`}
    >
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <Mascot name={profile?.mascot || "Lode"} size="sm" />
          <div className="leading-tight">
            <div className="text-sm font-bold">{profile?.name || "Acolyte"}</div>
            <div className="text-[11px] text-mist">
              {profile?.mascot || "Lode"} siap mengajar
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-full px-2 text-lg leading-none text-mist hover:text-night lg:hidden"
          aria-label="Tutup sidebar"
        >
          ×
        </button>
      </div>

      <div className="px-3 pt-3">
        <button
          onClick={onNewChat}
          className="w-full rounded-xl border border-white/10 bg-gradient-to-r from-sakura/20 to-mew/20 px-4 py-2.5 text-sm font-bold text-night transition hover:from-sakura/30 hover:to-mew/30"
        >
          + Percakapan baru
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        <section>
          <SectionTitle>Percakapan</SectionTitle>
          {conversations.length === 0 ? (
            <p className="px-1 text-xs text-mist">
              Belum ada percakapan. Mulai dengan tombol di atas.
            </p>
          ) : (
            <ul className="space-y-1">
              {conversations.map((c) => (
                <li key={c.id}>
                  <div
                    className={`group flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition ${
                      currentId === c.id
                        ? "bg-white/10"
                        : "hover:bg-white/5"
                    }`}
                  >
                    <button
                      onClick={() => onSelect(c.id)}
                      className="min-w-0 flex-1 text-xs"
                    >
                      <span
                        className={`block truncate font-semibold ${
                          currentId === c.id ? "text-night" : "text-night/80"
                        }`}
                      >
                        {c.title}
                      </span>
                      <span className="block text-[10px] text-mist">
                        {c.message_count} pesan
                        {c.folder ? " • " + c.folder.split("/").pop() : ""}
                      </span>
                    </button>
                    <button
                      onClick={() => onDelete(c.id)}
                      className="shrink-0 rounded-full px-1.5 text-xs text-mist opacity-0 transition group-hover:opacity-100 hover:text-sakura"
                      aria-label="Hapus percakapan"
                    >
                      ×
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </aside>
  );
}