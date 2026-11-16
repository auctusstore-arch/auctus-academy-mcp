# Keputusan & pertanyaan untuk Muhammad

## Default yang dipakai implementasi (bisa diubah)

| Topik | Default sekarang | Alasan |
|-------|------------------|--------|
| Satu Worker vs split AS/RS | Satu Worker, dua hostname | Lebih sederhana; split tetap mungkin |
| Kolaborator Saring pakai MCP (Q5) | **Mati per proyek**, pemilik bisa menyalakan di Koneksi AI | Data proyek ikut terkirim ke penyedia AI kolaborator |
| Approval W2 (Q7) | **Hanya di web Auctus**; model mendapat `approval_path` | Paling aman; elicitation bisa ditambah nanti |
| Ambang W2 | >20 record atau >5 exclude per operasi **dan kumulatif per jam** per klien + proyek | Menutup celah pemecahan panggilan (review) |
| Approval perlu login baru | Sesi web ≤12 jam (`amr`) | PRD §8 |
| `auctus_changes_commit` | Tidak ada: approval di web langsung menerapkan | Tidak ada jeda antara setuju dan terapkan |
| Revert perubahan yang disetujui manusia | Butuh approval lagi | Review |
| Free dan Idea Board | Free tetap tanpa MCP | Keputusan 13 Nov; lihat `idea-board-migration.md` |

## Masih terbuka (PRD §15)

3. ChatGPT Plus read-only: diterima?
8. Anggaran pentest eksternal (gerbang Fase 1)?
9. Listing direktori Fase 3?
10. Daftar user pilot.
11. Review legal UU PDP.
- Free di Idea Board (lihat `idea-board-migration.md`).
