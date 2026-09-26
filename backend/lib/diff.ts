const MAX_DIFF_LINES = 1200;
const MAX_CONTEXT = 3;

export interface DiffStat {
  added: number;
  removed: number;
  truncated: boolean;
}

export interface DiffResult extends DiffStat {
  diff: string;
}

/**
 * Diff baris tanpa dependensi (LCS). Falls back ke ringkasan kalau file
 * terlalu besar, supaya panel riwayat tidak meledak.
 */
export function diffLines(before: string, after: string): DiffResult {
  const a = splitLines(before);
  const b = splitLines(after);
  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) {
    return { ...summarize(a, b), diff: summarize(a, b).note };
  }
  const n = a.length;
  const m = b.length;
  const table = new Int32Array((n + 1) * (m + 1));
  const at = (i: number, j: number) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[at(i, j)] =
        a[i] === b[j]
          ? table[at(i + 1, j + 1)] + 1
          : Math.max(table[at(i + 1, j)], table[at(i, j + 1)]);
    }
  }
  const out: string[] = [];
  let added = 0;
  let removed = 0;
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push(`  ${a[i]}`);
      i += 1;
      j += 1;
    } else if (table[at(i + 1, j)] >= table[at(i, j + 1)]) {
      out.push(`- ${a[i]}`);
      removed += 1;
      i += 1;
    } else {
      out.push(`+ ${b[j]}`);
      added += 1;
      j += 1;
    }
  }
  while (i < n) {
    out.push(`- ${a[i]}`);
    removed += 1;
    i += 1;
  }
  while (j < m) {
    out.push(`+ ${b[j]}`);
    added += 1;
    j += 1;
  }
  return { diff: withContext(out), added, removed, truncated: false };
}

function splitLines(text: string): string[] {
  if (!text) return [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  // Baris kosong terakhir hanya artefak newline di akhir file.
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function summarize(a: string[], b: string[]): DiffStat & { note: string } {
  return {
    added: 0,
    removed: 0,
    truncated: true,
    note: `Diff disembunyikan: file terlalu besar (${a.length} → ${b.length} baris).`,
  };
}

/** Hanya tampilkan baris yang berubah ± konteks, sisanya jadi satu penanda. */
function withContext(lines: string[]): string {
  const keep = new Set<number>();
  lines.forEach((line, idx) => {
    if (line.startsWith("+") || line.startsWith("-")) {
      for (
        let k = Math.max(0, idx - MAX_CONTEXT);
        k <= Math.min(lines.length - 1, idx + MAX_CONTEXT);
        k += 1
      ) {
        keep.add(k);
      }
    }
  });
  const out: string[] = [];
  let skipped = 0;
  lines.forEach((line, idx) => {
    if (keep.has(idx)) {
      if (skipped > 0) {
        out.push(`  … ${skipped} baris tidak berubah`);
        skipped = 0;
      }
      out.push(line);
    } else {
      skipped += 1;
    }
  });
  if (skipped > 0) out.push(`  … ${skipped} baris tidak berubah`);
  return out.join("\n");
}

export function formatDiffHeader(
  rel: string,
  added: number,
  removed: number,
  created: boolean,
): string {
  const kind = created ? "dibuat" : "diubah";
  return `${rel} · ${kind} · +${added} −${removed} baris`;
}
