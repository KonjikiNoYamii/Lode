import type { PlanStatus, TopicStatus } from "@/types";

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

export function masteryTone(mastery: number): string {
  if (mastery >= 85) return "bg-kirimochi";
  if (mastery >= 60) return "bg-mew";
  if (mastery >= 30) return "bg-sakura";
  return "bg-mist";
}

export const PLAN_STATUS_META: Record<
  PlanStatus,
  { label: string; dot: string; chip: string }
> = {
  todo: {
    label: "Antrian",
    dot: "bg-mist",
    chip: "bg-mist/10 text-mist border-mist/20",
  },
  learning: {
    label: "Dikerjakan",
    dot: "bg-sakura",
    chip: "bg-sakura/10 text-sakura border-sakura/20",
  },
  done: {
    label: "Selesai",
    dot: "bg-kirimochi",
    chip: "bg-kirimochi/10 text-kirimochi border-kirimochi/20",
  },
  stuck: {
    label: "Stuck",
    dot: "bg-waku",
    chip: "bg-waku/10 text-waku border-waku/20",
  },
};