import { useEffect, useMemo, useState } from "react";
import type { Mood } from "@/types";
import {
  Sparkles,
  Smile,
  Zap,
  HelpCircle,
  Frown,
  Feather,
  type LucideIcon,
} from "lucide-react";

export interface MentorAvatarProps {
  name: string;
  mood?: Mood;
  size?: "sm" | "lg";
  speaking?: boolean;
  thinking?: boolean;
}

export const MOODS: Mood[] = [
  "netral",
  "senang",
  "semangat",
  "bingung",
  "sedih",
  "tenang",
];

export const MOOD_THEME: Record<
  Mood,
  {
    label: string;
    icon: LucideIcon;
    ring: string;
    shadow: string;
    glow: string;
    badge: string;
  }
> = {
  netral: {
    label: "fokus & siap",
    icon: Sparkles,
    ring: "ring-mew/50",
    shadow: "shadow-[0_0_24px_rgba(167,139,250,0.3)]",
    glow: "bg-mew/30",
    badge: "bg-mew/15 text-mew border-mew/30",
  },
  senang: {
    label: "senang",
    icon: Smile,
    ring: "ring-sakura/60",
    shadow: "shadow-[0_0_28px_rgba(255,110,199,0.35)]",
    glow: "bg-sakura/35",
    badge: "bg-sakura/15 text-sakura border-sakura/30",
  },
  semangat: {
    label: "bersemangat",
    icon: Zap,
    ring: "ring-waku/60",
    shadow: "shadow-[0_0_28px_rgba(251,191,36,0.35)]",
    glow: "bg-waku/35",
    badge: "bg-waku/15 text-waku border-waku/30",
  },
  bingung: {
    label: "bingung",
    icon: HelpCircle,
    ring: "ring-akari/60",
    shadow: "shadow-[0_0_24px_rgba(103,232,249,0.35)]",
    glow: "bg-akari/30",
    badge: "bg-akari/15 text-akari border-akari/30",
  },
  sedih: {
    label: "sedih",
    icon: Frown,
    ring: "ring-slate-400/50",
    shadow: "shadow-[0_0_22px_rgba(148,163,184,0.3)]",
    glow: "bg-slate-400/25",
    badge: "bg-slate-400/15 text-slate-300 border-slate-400/30",
  },
  tenang: {
    label: "tenang",
    icon: Feather,
    ring: "ring-kirimochi/60",
    shadow: "shadow-[0_0_26px_rgba(52,211,153,0.35)]",
    glow: "bg-kirimochi/30",
    badge: "bg-kirimochi/15 text-kirimochi border-kirimochi/30",
  },
};

const EXTENSIONS = [".png", ".webp", ".jpg", ".jpeg"];

export function getCandidateUrls(mood: Mood): string[] {
  const list: string[] = [];
  for (const ext of EXTENSIONS) {
    list.push(`/avatars/yami-${mood}${ext}`);
  }
  if (mood !== "netral") {
    for (const ext of EXTENSIONS) {
      list.push(`/avatars/yami-netral${ext}`);
    }
  }
  return list;
}

export default function MentorAvatar({
  name,
  mood = "netral",
  size = "lg",
  speaking = false,
  thinking = false,
}: MentorAvatarProps) {
  const candidates = useMemo(() => getCandidateUrls(mood), [mood]);
  const [candidateIdx, setCandidateIdx] = useState(0);

  // Preload all mood images on mount so swapping is instantaneous
  useEffect(() => {
    MOODS.forEach((m) => {
      const img = new Image();
      img.src = `/avatars/yami-${m}.png`;
    });
  }, []);

  // Reset candidate index when mood changes
  useEffect(() => {
    setCandidateIdx(0);
  }, [mood]);

  const currentSrc = candidates[candidateIdx] ?? "/avatars/yami-netral.png";
  const theme = MOOD_THEME[mood] ?? MOOD_THEME.netral;
  const MoodIcon = theme.icon;
  const box = size === "lg" ? "h-40 w-40" : "h-24 w-24";

  const handleImgError = () => {
    if (candidateIdx < candidates.length - 1) {
      setCandidateIdx((prev) => prev + 1);
    }
  };

  return (
    <div className="flex flex-col items-center gap-3 select-none">
      <div className={`relative ${box}`}>
        {/* Speaking aura glow - subtle and calm, without wobbling */}
        {speaking && (
          <div
            className={`absolute -inset-2.5 -z-10 rounded-full blur-xl avatar-glow transition-colors duration-500 ${theme.glow}`}
          />
        )}

        {/* Ambient mood aura */}
        <div
          className={`absolute -inset-1 -z-10 rounded-full blur-md opacity-60 transition-colors duration-500 ${theme.glow}`}
        />

        <div className="h-full w-full">
          <img
            key={`${mood}-${currentSrc}`}
            src={currentSrc}
            alt={`${name} — ${theme.label}`}
            onError={handleImgError}
            className={`mood-pop h-full w-full rounded-full object-cover ring-2 transition-all duration-300 ${theme.ring} ${theme.shadow}`}
          />
        </div>

        {/* Thinking indicator */}
        {thinking && (
          <div className="absolute -bottom-2.5 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/10 bg-panel px-2 py-0.5 shadow-lg">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-sakura" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-mew [animation-delay:150ms]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-akari [animation-delay:300ms]" />
          </div>
        )}
      </div>

      <div className="flex flex-col items-center gap-1 text-center">
        <div
          className={`font-extrabold tracking-wide ${
            size === "lg" ? "text-sm" : "text-xs"
          }`}
        >
          {name}
        </div>
        <div
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors duration-300 ${theme.badge}`}
        >
          <MoodIcon className="h-3 w-3 shrink-0" />
          <span>{theme.label}</span>
        </div>
      </div>
    </div>
  );
}