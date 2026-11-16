# Rencana Fase 1 — impor PubMed ke Saring (dokumentasi saja)

**Status:** belum diimplementasi di MCP Worker. Dokumen ini menjelaskan alur produk yang direncanakan setelah tool baca PubMed Fase 0.

## Tujuan

Memungkinkan pengguna mengimpor hasil pencarian PubMed ke proyek **Saring** sebagai rekaman screening, dengan deduplikasi terhadap rekaman yang sudah ada.

## Alur tingkat tinggi

1. Pengguna memilih proyek Saring dan memicu impor (dari klien MCP atau UI academy).
2. Worker / backend mengambil metadata artikel (PMID, judul, abstrak) — sumber teks tetap `untrusted_content`.
3. Sistem menjalankan **deduplikasi** terhadap rekaman existing (PMID, DOI, dan/atau fingerprint judul — kebijakan final di academy).
4. Rekaman baru disimpan dengan status awal `undecided`.

## Workflow persetujuan (W1 vs W2)

| Ukuran impor | Workflow | Catatan |
|--------------|----------|---------|
| ≤ 20 rekaman | **W1** (otomatis setelah consent scope) | Cocok dengan batas batch PMID Fase 0 |
| > 20 rekaman | **W2** (persetujuan di web Auctus) | User melihat pratinjau jumlah + dedup sebelum commit |

W2 mengikuti pola ancaman T1/T17: tidak ada write bulk tanpa konfirmasi eksplisit di sesi web terpercaya.

## Dedup

- Primary key eksternal: **PMID** jika ada.
- Fallback: **DOI** normalisasi (lower-case, tanpa URL wrapper).
- Tertiary (opsional): hash judul + tahun — hanya jika PMID/DOI kosong.

Rekaman duplikat tidak dibuat ulang; respons impor menyertakan hitungan `skipped_duplicate`.

## Scope & entitlement

- Impor membutuhkan scope tulis baru (mis. `sr.write` atau tool khusus `auctus_saring_import_pubmed`) — **bukan** bagian Fase 0.
- Gate paket sama: Complete / coaching / pilot; Free ditolak.

## Audit & privasi

- Log audit: `project_id`, jumlah rekaman, jumlah dedup, **bukan** teks abstrak penuh.
- Query pencarian PubMed: hash + panjang saja (sama dengan kebijakan Fase 0).

## Ketergantungan academy

- RPC Supabase untuk insert batch `saring.records` + trigger dedup.
- Halaman W2 impor PubMed di `auctus.academy`.
- Migrasi indeks unik `(project_id, pmid)` atau `(project_id, external_id)`.