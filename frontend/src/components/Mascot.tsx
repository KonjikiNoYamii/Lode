export function Mascot({
  name,
  size = "md",
}: {
  name?: string;
  size?: "sm" | "md" | "lg";
}) {
  const cls =
    size === "lg"
      ? "h-16 w-16 text-3xl"
      : size === "sm"
        ? "h-8 w-8 text-sm"
        : "h-10 w-10 text-lg";

  return (
    <div
      className={`${cls} grid select-none place-items-center rounded-full bg-gradient-to-br from-sakura to-mew font-extrabold text-white shadow-lg shadow-sakura/20 ring-2 ring-white/20`}
    >
      {(name?.trim()[0] ?? "S").toUpperCase()}
    </div>
  );
}