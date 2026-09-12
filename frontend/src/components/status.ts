import type { TopicStatus } from "@/types";

export const STATUS_META: Record<
  TopicStatus,
  { label: string; dot: string; chip: string }
> = {
  mastered: {
    label: "Dikuasai",
    dot: "bg-kirimochi",
    chip: "bg-kirimochi/10 text-kirimochi border-kirimochi/20",
  },
  learning: {
    label: "Diproses",
    dot: "bg-sakura",
    chip: "bg-sakura/10 text-sakura border-sakura/20",
  },
  stuck: {
    label: "Stuck",
    dot: "bg-waku",
    chip: "bg-waku/10 text-waku border-waku/20",
  },
  todo: {
    label: "Antrian",
    dot: "bg-mist",
    chip: "bg-mist/10 text-mist border-mist/20",
  },
};