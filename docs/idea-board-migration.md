# Idea Board: pindah dari PubMed MCP pihak ketiga ke Auctus MCP

Status: rencana + tool baca sudah ada di branch `feat/pubmed-idea-board-tools`. Belum ada perubahan di auctus-academy maupun repo skill.

## Masalah sekarang

Track AI di Idea Board (`src/modules/idea-board/` di auctus-academy) menyuruh user menempel prompt ke claude.ai. Prompt itu:

1. memasang skill dari repo `auctusstore-arch/auctus-sr-ma-ideation`, dan
2. menyambungkan PubMed lewat `https://pubmed.caseyjhand.com/mcp` (server pihak ketiga, tanpa autentikasi).

Akibatnya query riset user terkirim ke pihak ketiga, dan Idea Board bergantung pada uptime dan versi server itu. Ini yang ditolak di keputusan 15 Nov 2026 (#1789).

## Pemetaan kebutuhan ke tool Auctus MCP

| Kebutuhan di workflow ideasi | Tool Auctus MCP | Status |
|---|---|---|
| Cari studi original per topik | `auctus_pubmed_search` (+ `publication_types`) | ada |
| Cari SR/MA terbaru (cek novelty) | `auctus_pubmed_search` dengan `publication_types: ["Systematic Review","Meta-Analysis"]`, `sort: "pub_date"` | baru (`sort`) |
| Ambil judul/abstrak | `auctus_pubmed_get_articles` | ada |
| Istilah MeSH untuk strategi pencarian | `auctus_pubmed_mesh_lookup` | ada |
| Cek PMID yang dikutip Claude benar ada (anti PMID karangan), tanggal, dan apakah review | `auctus_pubmed_verify_pmids` (maks 50) | baru |
| Similar articles / cited by / referensi dari satu paper (literature mapping) | `auctus_pubmed_find_related` (`similar`, `cited_by`, `references`) | baru |
| Simpan ide + PMID bukti ke Idea Board langsung dari AI | `auctus_idea_board_*` (tulis) | belum, Fase 1 (butuh scope tulis, lihat bawah) |
| Baca ide yang sudah tersimpan | `auctus_idea_board_list_ideas` (baca) | belum, butuh port Supabase |

`auctus_pubmed_verify_pmids` memakai aturan review yang sama dengan `REVIEW_PUB_TYPES` di `idea-board/pubmed.ts`, jadi hasil cek di AI dan di Idea Board konsisten.

## Hal yang harus diputuskan Muhammad

1. **Paket Free.** Track AI Idea Board saat ini ditulis "Paket Free cukup", sedangkan keputusan 13 Nov 2026 menyatakan Free tanpa MCP sama sekali. Pilihannya:
   - (a) Free tetap tanpa MCP. Track AI hanya penuh untuk Complete/Coaching; user Free memakai track manual (tempel PMID, sudah dicek server Auctus).
   - (b) Scope khusus `pubmed.read` untuk Free: hanya tool PubMed publik, tanpa data workspace, dengan rate limit lebih ketat. Ini mengubah keputusan 13 Nov dan menambah permukaan auth untuk user Free.
   - (c) Free tetap boleh memakai server PubMed pihak ketiga sementara, berbayar pindah ke Auctus MCP. Risiko kebocoran query tetap ada untuk Free.
2. **Tulis ke Idea Board dari AI** (Fase 1): tingkat W1 (simpan draf ide, bisa diedit/dihapus user di web) atau hanya lewat web.

## Urutan kerja yang diusulkan

1. Merge PR fondasi (#1) dan PR tool PubMed ini.
2. Selesaikan login upstream Supabase dan port data (prasyarat semua tool non-mock).
3. Update repo skill `auctus-sr-ma-ideation`: ganti instruksi PubMed ke tool `auctus_pubmed_*`, pakai `auctus_pubmed_verify_pmids` sebelum menulis baris `BUKTI FEASIBILITY` / `SR TERAKHIR`.
4. Update `CLAUDE_IDEATION_PROMPT`, `PUBMED_MCP_URL`, dan layar `PubmedConnectScreen` di auctus-academy agar menunjuk ke `https://mcp.auctus.academy/mcp` (sesuai keputusan Free di atas).
5. Paketkan skill + konfigurasi MCP sebagai plugin Auctus (Claude, Codex, Cursor, Antigravity), sehingga user cukup memasang satu plugin.
6. Fase 1: `auctus_idea_board_save_idea` agar ide + bukti terverifikasi langsung masuk ke Idea Board tanpa salin-tempel.
