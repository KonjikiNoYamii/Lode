import type { Message } from "@/types";
import { loadState, send, get } from "@/api";
import { useCallback, useEffect, useState } from "react";
import ChatSidebar from "@/components/ChatSidebar";
import ChatRoom from "@/components/ChatRoom";
import type { Conversation, Memory, Profile, Topic } from "@/types";

export default function ChatPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [progressTopics, setProgressTopics] = useState<Topic[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
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
        const r = await get<{ topics: Topic[]; memories: Memory[] }>(
          `/api/conversations/${id}/progress`,
        );
        setProgressTopics(r.topics);
        setMemories(r.memories);
      } catch {
        setProgressTopics([]);
        setMemories([]);
      }
    } else {
      setProgressTopics([]);
      setMemories([]);
    }
  }, []);

  useEffect(() => {
    refresh(null);
  }, [refresh]);

  const [totalMessages, setTotalMessages] = useState(0);

  const addMessages = useCallback((msgs: Message[]) => {
    setMessages((prev) => [...prev, ...msgs]);
    setTotalMessages((prev) => prev + msgs.length);
  }, []);

  const loadConversation = useCallback(
    async (id: number) => {
      try {
        const data = await get<{ messages: Message[]; total_messages?: number }>(
          `/api/conversations/${id}?limit=50`,
        );
        setCurrentId(id);
        setMessages(data.messages);
        setTotalMessages(data.total_messages ?? data.messages.length);
        setSideOpen(false);
        await refresh(id);
      } catch {
        // gagal buka percakapan
      }
    },
    [refresh],
  );

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
    setMessages([]);
    setTotalMessages(0);
    setProgressTopics([]);
    setSideOpen(false);
  }, []);

  const removeConversation = useCallback(
    async (id: number) => {
      try {
        await send(`/api/conversations/${id}`, "DELETE");
        if (currentId === id) {
          newChat();
        } else {
          await refresh(currentId);
        }
      } catch {
        // gagal hapus
      }
    },
    [currentId, newChat, refresh],
  );

  const onNewConversation = useCallback(
    async (id: number) => {
      setCurrentId(id);
      await refresh(id);
    },
    [refresh],
  );

  const currentTitle =
    conversations.find((c) => c.id === currentId)?.title ?? "Percakapan baru";
  const currentFolder =
    conversations.find((c) => c.id === currentId)?.folder ?? profile?.workspace ?? "";

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
      />

      <ChatRoom
        currentId={currentId}
        title={currentTitle}
        folder={currentFolder}
        profile={profile}
        messages={messages}
        topics={progressTopics}
        memories={memories}
        totalMessages={totalMessages}
        onLoadEarlier={loadEarlierMessages}
        addMessages={addMessages}
        onNewConversation={onNewConversation}
        onMemoryUpdated={(id) => refresh(id)}
        onNewChat={newChat}
        onOpenSidebar={() => setSideOpen(true)}
        onSetFolder={setFolder}
      />
    </div>
  );
}