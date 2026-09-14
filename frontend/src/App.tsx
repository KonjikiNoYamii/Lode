import { useState } from "react";
import { Mascot } from "./components/Mascot";
import ChatPage from "./pages/ChatPage";
import SettingsPage from "./pages/SettingsPage";

export default function App() {
  const [view, setView] = useState<"chat" | "settings">("chat");

  return (
    <div className="relative min-h-screen">
      <div className="anime-bg fixed inset-0 -z-10" />

      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-white/10 bg-panel/70 px-4 py-2.5 backdrop-blur sm:px-6">
        <div className="flex items-center gap-2.5">
          <Mascot name="Lode" size="sm" />
          <div className="leading-tight">
            <div className="bg-gradient-to-r from-sakura to-mew bg-clip-text text-lg font-extrabold text-transparent">
              Lode
            </div>
            <div className="-mt-0.5 text-[11px] text-mist">
              Dev Guide • Persistent Memory
            </div>
          </div>
        </div>
        <nav className="flex gap-1.5">
          {(["chat", "settings"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
                view === v
                  ? "bg-gradient-to-r from-sakura/80 to-mew/80 text-white shadow-lg shadow-sakura/20"
                  : "text-mist hover:text-night hover:bg-white/5"
              }`}
            >
              {v === "chat" ? "Chat" : "Profil & Server"}
            </button>
          ))}
        </nav>
      </header>

      <main className={view === "chat" ? "h-[calc(100dvh-4rem)]" : "mx-auto max-w-2xl px-4 py-8"}>
        {view === "chat" ? <ChatPage /> : <SettingsPage />}
      </main>
    </div>
  );
}