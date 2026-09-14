import { useState } from "react";
import { GraduationCap } from "lucide-react";

export function Mascot({
  name,
  size = "md",
}: {
  name?: string;
  size?: "sm" | "md" | "lg";
}) {
  const [imgError, setImgError] = useState(false);

  const cls =
    size === "lg"
      ? "h-16 w-16"
      : size === "sm"
        ? "h-8 w-8"
        : "h-10 w-10";

  const iconCls =
    size === "lg"
      ? "h-8 w-8"
      : size === "sm"
        ? "h-4 w-4"
        : "h-5 w-5";

  if (!imgError) {
    return (
      <img
        src="/avatars/yami-netral.png"
        alt={name || "Lode"}
        onError={() => setImgError(true)}
        className={`${cls} select-none rounded-full object-cover ring-2 ring-sakura/40 shadow-md shadow-sakura/20 shrink-0`}
      />
    );
  }

  return (
    <div
      className={`${cls} grid select-none place-items-center rounded-full bg-gradient-to-br from-sakura to-mew text-white shadow-lg shadow-sakura/20 ring-2 ring-white/20 shrink-0`}
    >
      <GraduationCap className={iconCls} />
    </div>
  );
}