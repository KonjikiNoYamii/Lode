export type Role = "user" | "assistant";

export interface Profile {
  id: number;
  name: string;
  language: string;
  skill_level: string;
  goals: string;
  learning_style: string;
  mascot: string;
  workspace: string;
  ws_max_depth: number;
  ws_max_files: number;
  ws_auto_kb: number;
  ws_allow_write: number;
  ai_base_url: string;
  ai_api_key: string;
  ai_model: string;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: number;
  title: string;
  folder: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

export interface Message {
  id: number;
  conversation_id: number;
  role: Role;
  content: string;
  created_at: string;
  mood?: string;
}

export type Mood =
  | "netral"
  | "senang"
  | "semangat"
  | "bingung"
  | "sedih"
  | "tenang";

export type TopicStatus = "mastered" | "learning" | "stuck" | "todo";

export interface Topic {
  id: number;
  name: string;
  status: TopicStatus;
  notes: string;
  conversation_id: number;
  updated_at: string;
}

export interface Memory {
  id: number;
  type: string;
  content: string;
  created_at: string;
}

export interface State {
  profile: Profile;
  conversations: Conversation[];
  topics: Topic[];
  memories: Memory[];
}