import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const tempDir = mkdtempSync(join(tmpdir(), "lode-idempotency-"));
process.env.DATA_DIR = tempDir;

// Import setelah DATA_DIR di-set supaya DB dibuat di direktori temp.
const {
  addMessage,
  createConversation,
  listMessages,
  replaceMessage,
} = await import("./db");

let cid = 0;

beforeAll(() => {
  cid = createConversation("Test Idempotensi");
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("addMessage dengan clientMsgId", () => {
  it("tidak membuat baris duplikat saat clientMsgId sama dikirim dua kali", () => {
    addMessage(cid, "user", "pesan ganda", "", "", "dup-1");
    addMessage(cid, "user", "pesan ganda", "", "", "dup-1");
    const rows = listMessages(cid).filter((m) => m.client_msg_id === "dup-1");
    expect(rows.length).toBe(1);
  });

  it("menyimpan pesan berbeda dengan clientMsgId berbeda", () => {
    addMessage(cid, "user", "pesan satu", "", "", "a-1");
    addMessage(cid, "user", "pesan dua", "", "", "a-2");
    const rows = listMessages(cid).filter((m) =>
      (m.client_msg_id ?? "").startsWith("a-"),
    );
    expect(rows.length).toBe(2);
  });
});

describe("replaceMessage (Ulangi)", () => {
  it("mengganti isi jawaban assistant di tempat tanpa menambah baris", () => {
    addMessage(cid, "user", "pertanyaan ulangi");
    addMessage(cid, "assistant", "jawaban lama (terpotong)");
    const before = listMessages(cid);
    const target = before.find((m) => m.role === "assistant");

    const ok = target ? replaceMessage(cid, target.id, "jawaban baru", "senang", "latihan") : false;
    expect(ok).toBe(true);

    const after = listMessages(cid);
    expect(after.length).toBe(before.length); // tidak ada pesan baru
    const replaced = after.find((m) => m.role === "assistant");
    expect(replaced?.content).toBe("jawaban baru");
    expect(replaced?.mood).toBe("senang");
    expect(replaced?.mode).toBe("latihan");
  });

  it("tidak bisa mengganti pesan user", () => {
    addMessage(cid, "user", "pertanyaan user");
    const userMsg = listMessages(cid).filter((m) => m.role === "user").pop();
    const ok = userMsg ? replaceMessage(cid, userMsg.id, "abc") : true;
    expect(ok).toBe(false);
  });
});