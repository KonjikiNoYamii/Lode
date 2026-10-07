import { forkConversation, importConversation, downloadConversation, forkCleanConversation } from "@/api";
import type { Message } from "@/types";
import { loadState, send, get } from "@/api";
import { useCallback, useEffect, useState } from "react";
import ChatSidebar from "@/components/ChatSidebar";
import ChatRoom from "@/components/ChatRoom";
import type {
  Conversation,
  FileRevision,
  LearnMode,
  Memory,
  PlanItem,
  Profile,
  Topic,
} from "@/types";

const LAST_CONVERSATION_KEY = "sensei-mentor:last-conversation";

function getLastConversationId(): number | null {
  try {
    const value = Number.parseInt(
      window.localStorage.getItem(LAST_CONVERSATION_KEY) ?? "",
      10,
    );
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function rememberConversation(id: number | null): void {
  try {
    if (id) {
      window.localStorage.setItem(LAST_CONVERSATION_KEY, String(id));
    } else {
      window.localStorage.removeItem(LAST_CONVERSATION_KEY);
    }
  } catch {
    return;
  }
}

export default function ChatPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [progressTopics, setProgressTopics] = useState<Topic[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [plan, setPlan] = useState<PlanItem[]>([]);
  const [revisions, setRevisions] = useState<FileRevision[]>([]);
  const [mode, setMode] = useState<LearnMode>("auto");
  const [effectiveMode, setEffectiveMode] = useState<LearnMode>("konsep");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [sideOpen, setSideOpen] = useState(false);

  const refresh = useCallback(async (id: number | null) => {
    try {
      const s = await loadState();
      setConversations(s.conversations);
      setProfile(s.profile);
    } catch {
      // state belum siap
    }
    if (id) {
      try {
        const r = await get<{
          topics: Topic[];
          memories: Memory[];
          plan?: PlanItem[];
          revisions?: FileRevision[];
        }>(`/api/conversations/${id}/progress`);
        setProgressTopics(r.topics);
        setMemories(r.memories);
        setPlan(r.plan ?? []);
        setRevisions(r.revisions ?? []);
      } catch {
        setProgressTopics([]);
        setMemories([]);
        setPlan([]);
        setRevisions([]);
      }
    } else {
      setProgressTopics([]);
      setMemories([]);
      setPlan([]);
      setRevisions([]);
    }
  }, []);

  const [totalMessages, setTotalMessages] = useState(0);

  const addMessages = useCallback((msgs: Message[]) => {
    setMessages((prev) => [...prev, ...msgs]);
    setTotalMessages((prev) => prev + msgs.length);
  }, []);

  const loadConversation = useCallback(
    async (id: number): Promise<boolean> => {
      setMessages([]);
      setTotalMessages(0);
      try {
        const data = await get<{
          messages: Message[];
          total_messages?: number;
          mode?: LearnMode;
          effective_mode?: LearnMode;
        }>(`/api/conversations/${id}?limit=50`);
        setCurrentId(id);
        setMessages(data.messages);
        setTotalMessages(data.total_messages ?? data.messages.length);
        setMode(data.mode ?? "auto");
        setEffectiveMode(data.effective_mode ?? "konsep");
        setSideOpen(false);
        rememberConversation(id);
        await refresh(id);
        return true;
      } catch {
        setCurrentId(null);
        setTotalMessages(0);
        rememberConversation(null);
        await refresh(null);
        return false;
      }
    },
    [refresh],
  );

  useEffect(() => {
    const lastId = getLastConversationId();
    if (lastId) {
      void loadConversation(lastId);
    } else {
      void refresh(null);
    }
  }, [loadConversation, refresh]);

  const loadEarlierMessages = useCallback(async () => {
    if (!currentId || messages.length === 0) return;
    const firstId = messages[0].id;
    try {
      const data = await get<{ messages: Message[]; total_messages?: number }>(
        `/api/conversations/${currentId}?limit=50&before=${firstId}`,
      );
      if (data.messages && data.messages.length > 0) {
        setMessages((prev) => [...data.messages, ...prev]);
        if (typeof data.total_messages === "number") {
          setTotalMessages(data.total_messages);
        }
      }
    } catch {
      // gagal muat pesan lama
    }
  }, [currentId, messages]);

  const newChat = useCallback(() => {
    setCurrentId(null);
    rememberConversation(null);
    setMessages([]);
    setTotalMessages(0);
    setProgressTopics([]);
    setPlan([]);
    setSideOpen(false);
  }, []);

  const removeConversation = useCallback(
    async (id: number) => {
      try {
        await send(`/api/conversations/${id}`, "DELETE");
        if (currentId === id) {
          newChat();
        }
        await refresh(currentId === id ? null : currentId);
      } catch {
        // gagal hapus
      }
    },
    [currentId, newChat, refresh],
  );

  const onNewConversation = useCallback(
    async (id: number) => {
      setCurrentId(id);
      rememberConversation(id);
      await refresh(id);
    },
    [refresh],
  );

  const currentTitle =
    conversations.find((c) => c.id === currentId)?.title ?? "Percakapan baru";
  const currentFolder =
    conversations.find((c) => c.id === currentId)?.folder ?? profile?.workspace ?? "";

  const setModeForConversation = useCallback(
    async (next: LearnMode) => {
      setMode(next);
      if (currentId) {
        try {
          await send(`/api/conversations/${currentId}`, "PATCH", { mode: next });
        } catch {
          return;
        }
      }
      await refresh(currentId);
    },
    [currentId, refresh],
  );

  const setFolder = useCallback(
    async (f: string) => {
      if (currentId) {
        await send(`/api/conversations/${currentId}`, "PATCH", { folder: f });
      } else {
        await send("/api/profile", "PUT", { workspace: f });
      }
      await refresh(currentId);
    },
    [currentId, refresh],
  );

  const handleFork = async (id: number) => {
    try {
      const r = await forkConversation(id);
      if (!r.id) return;
      const ok = await loadConversation(r.id);
      if (!ok) alert("Fork berhasil dibuat, tapi gagal memuatnya. Coba pilih dari daftar percakapan.");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Gagal fork");
    }
  };

  const handleForkClean = async (id: number) => {
    try {
      const r = await forkCleanConversation(id);
      if (!r.id) return;
      const ok = await loadConversation(r.id);
      if (!ok) {
        alert("Sesi baru berhasil dibuat, tapi gagal memuatnya. Coba pilih dari daftar percakapan.");
      }
      if (r.warnings && r.warnings.length > 0) {
        alert(r.warnings.join("\n"));
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Gagal fork bersih");
    }
  };
  return (
    <div className="flex h-full gap-3 p-3">
      {sideOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/60 lg:hidden"
          onClick={() => setSideOpen(false)}
        />
      )}

      <ChatSidebar
        open={sideOpen}
        onClose={() => setSideOpen(false)}
        profile={profile}
        conversations={conversations}
        currentId={currentId}
        onNewChat={newChat}
        onSelect={loadConversation}
        onDelete={removeConversation}
        onImport={handleImport}
      />

      <ChatRoom
        currentId={currentId}
        title={currentTitle}
        folder={currentFolder}
        profile={profile}
        messages={messages}
        topics={progressTopics}
        memories={memories}
        plan={plan}
        revisions={revisions}
        hasFolder={Boolean(currentFolder)}
        onRevisionsUpdated={() => void refresh(currentId)}
        mode={mode}
        effectiveMode={effectiveMode}
        totalMessages={totalMessages}
        onLoadEarlier={loadEarlierMessages}
        addMessages={addMessages}
        onNewConversation={onNewConversation}
        onMemoryUpdated={(id) => refresh(id)}
        onPlanUpdated={setPlan}
        onSetMode={setModeForConversation}
        onEffectiveMode={setEffectiveMode}
        onNewChat={newChat}
        onOpenSidebar={() => setSideOpen(true)}
        onSetFolder={setFolder}
        onFork={handleFork}
        onForkClean={handleForkClean}
        onExport={handleExport}
      />
    </div>
  );
}

  const handleExport = async (id: number) => {
    try {
      const data = await downloadConversation(id);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const name = (data?.conversation?.title || "percakapan").toString().replace(/[^a-z0-9\-]+/gi, "-").slice(0, 40);
      a.href = url;
      a.download = `lode-${name || "percakapan"}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Gagal ekspor");
    }
  };
  const handleImport = async (file: File) => {
    try {
      const txt = await file.text();
      const payload = JSON.parse(txt);
      const r = await importConversation(payload);
      if (r.id) {
        rememberConversation(r.id);
        window.location.reload();
      }
      if (r.warnings && r.warnings.length > 0) {
        alert(r.warnings.join("\n"));
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Gagal impor");
    }
  };
