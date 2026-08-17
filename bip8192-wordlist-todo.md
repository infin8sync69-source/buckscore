# BIP-8192 Soul Wordlist — Deep Build Todo List

> **Classification: INTERNAL / PROPRIETARY**
> The BIP-8192 soul wordlist is derived from the Soul of the World corpus.
> These files must NEVER be committed to any public repository.
> All word list files are for Chain 8192 internal use only.

**Legend:**
- Assignees: `[DEV]` Developer · `[TRANS]` Translator/Linguist · `[CRYPTO]` Cryptographer/Security · `[UX]` UX Designer · `[PM]` Project Manager
- Priority: 🔴 Critical · 🟠 High · 🟡 Medium · 🟢 Low
- Effort: estimated person-hours or days
- `blocked by: #X.Y` = cannot start until that item is done

---

## 1. Corpus Extraction Pipeline

**Goal:** Extract a raw candidate pool of 5,000–10,000 unique Arabic words from the Soul of the World corpus, ready for curation.

---

- [ ] **1.1** 🔴 `[DEV]` Obtain a clean, machine-readable UTF-8 plaintext version of the Soul of the World corpus structured by resonance layer (114 total) and wisdom node. Verify character encoding is NFC-normalized Arabic Unicode (U+0600–U+06FF range). Store in `corpus/source/soul-of-the-world-raw.txt`. Do not commit this file to any public repo — add to `.gitignore` immediately.
  *Effort: 4h*

- [ ] **1.2** 🔴 `[DEV]` Create the private repo `bucks-wordlist` (GitLab/self-hosted only). Set visibility to **Private**. Add `.gitignore` entries:
  ```
  corpus/
  assets/wordlists/
  bip8192-wordlist-*.txt
  bip8192-index.json
  bip8192-manifest.json
  ```
  Add a `README.md` warning: "This repository contains proprietary word list data for Chain 8192. No file in `corpus/` or `assets/wordlists/` may be published publicly."
  *Effort: 1h*

- [ ] **1.3** 🔴 `[DEV]` Set up a Python 3.11+ virtual environment for the extraction pipeline. Install dependencies:
  ```
  pip install camel-tools qalsadi pyarabic unicodedata2 tqdm
  ```
  Pin all versions in `requirements-extraction.txt`. Document setup steps in `corpus/PIPELINE.md`.
  *Effort: 2h*

- [ ] **1.4** 🔴 `[DEV]` Write `corpus/scripts/01_tokenize.py`. This script must:
  - Read `corpus/source/soul-of-the-world-raw.txt`
  - Split by resonance layer (114 sections) and by wisdom node within each layer
  - Tokenize each wisdom node into individual Arabic word tokens using whitespace + Arabic punctuation delimiters (`،` `؟` `؛` `.` etc.)
  - Strip diacritics (tashkeel/harakat: U+064B–U+065F) from all tokens — store both the diacritized form and the undiacritized form
  - Strip tatweel (U+0640) from all tokens
  - Output: `corpus/intermediate/tokenized.jsonl` — one JSON object per wisdom node: `{"layer": int, "node": int, "tokens_raw": [...], "tokens_stripped": [...]}`
  *Effort: 6h*

- [ ] **1.5** 🔴 `[DEV]` Write `corpus/scripts/02_morphological_analysis.py`. This script must:
  - Read `corpus/intermediate/tokenized.jsonl`
  - For each unique undiacritized token, run morphological analysis using `camel_tools.morphology.analyzer` (CamelMorph database) to extract the **lemma** (dictionary base form) and the **root** (3–4 letter root)
  - For tokens where CamelMorph returns no analysis, fall back to `qalsadi` for lemma extraction
  - Record for each token: `{"surface": str, "lemma": str, "root": str, "pos": str, "freq": int, "layers_found_in": [int, ...]}`
  - Output: `corpus/intermediate/morphology.jsonl`
  *Effort: 8h*
  *blocked by: #1.4*

- [ ] **1.6** 🟠 `[DEV]` Decide and document the **root vs. lemma vs. surface** strategy in `corpus/DECISIONS.md`:
  - **Recommended:** Use the **lemma** form (not the 3-letter root, not the surface form). Rationale: roots are too short (3–4 chars) and ambiguous across many words; surface forms are inflected and harder to memorize. Lemmas are pronounceable dictionary forms.
  - Exception: if lemma extraction fails for a token, fall back to the surface form (undiacritized)
  - Document this decision with sign-off from at least one Arabic-speaking reviewer `[TRANS]`
  *Effort: 2h*
  *blocked by: #1.5*

- [ ] **1.7** 🔴 `[DEV]` Write `corpus/scripts/03_filter.py`. Apply the following exclusion rules to the morphology data. Exclude any lemma/word that:
  - Has fewer than **3 Arabic characters** (after stripping diacritics and tatweel)
  - Has more than **12 Arabic characters** — words this long are difficult to memorize and type
  - POS tag is any of: `PREP` (preposition), `CONJ` (conjunction), `PART` (particle), `DET` (determiner, e.g., ال), `PUNC` (punctuation), `NUM` (numeral), `ABBREV` (abbreviation), `INTERJ` (interjection)
  - Contains any non-Arabic character (Latin, numerals, symbols)
  - Is a proper noun (`NOUN_PROP` in CamelMorph POS)
  - Appears in the `corpus/blocklist.txt` file (manually curated — see #1.9)
  - Output: `corpus/intermediate/filtered.jsonl`
  *Effort: 5h*
  *blocked by: #1.5, #1.6*

- [ ] **1.8** 🟠 `[TRANS]` Create `corpus/blocklist.txt` — a manually curated list of words to exclude regardless of frequency. Categories to block:
  - Politically sensitive or divisive terms
  - Any word that is a name of a person, place, or organization
  - Words with strong negative connotations in any of the Tier 1 target languages
  - Words that are homophones or near-homophones of offensive words in English, French, Spanish, Turkish, or Urdu
  Document each blocked word with a one-line reason. Minimum first-pass: review 500 most frequent candidates.
  *Effort: 8h*

- [ ] **1.9** 🔴 `[DEV]` Write `corpus/scripts/04_deduplicate.py`. Produce the raw candidate pool:
  - From `corpus/intermediate/filtered.jsonl`, extract the unique lemma set
  - Sort by **descending frequency** (number of times the lemma appears across all wisdom nodes of all resonance layers)
  - Secondary sort: ascending character count (prefer shorter words at equal frequency)
  - Output: `corpus/raw-candidates.txt` — one lemma per line, UTF-8, no header, no numbers, Arabic script only
  - Also output: `corpus/raw-candidates-with-stats.tsv` with columns: `rank | lemma | root | freq | layer_count | char_count`
  - Target: 5,000–10,000 unique entries
  *Effort: 3h*
  *blocked by: #1.7, #1.8*

- [ ] **1.10** 🟠 `[DEV]` Write a validation script `corpus/scripts/validate_candidates.py` that asserts:
  - All entries in `raw-candidates.txt` are valid Arabic Unicode strings
  - No entry contains Latin characters, numerals, or punctuation
  - No duplicates
  - All entries are NFC-normalized
  - Character count is 3–12 for every entry
  - Count is between 5,000 and 10,000
  Run this as a CI gate. Output: pass/fail + summary stats.
  *Effort: 2h*
  *blocked by: #1.9*

---

## 2. Word Selection & Curation (down to exactly 2,048)

**Goal:** Deterministically select exactly 2,048 words from the raw candidate pool with maximum semantic distinctiveness, memorability, and collision resistance.

---

- [ ] **2.1** 🔴 `[DEV]` Write `corpus/scripts/05_levenshtein_filter.py`. This is the most compute-intensive step:
  - Load `corpus/raw-candidates.txt` (sorted by rank/frequency, best first)
  - Implement a greedy selection algorithm:
    1. Start with an empty selected set `S`
    2. Iterate through candidates in rank order
    3. For each candidate word `w`, compute Levenshtein distance between `w` and every word already in `S`
    4. If the minimum distance to any word in `S` is **≥ 3**, add `w` to `S`
    5. Stop when `|S| == 2,048` or candidates are exhausted
  - Use the `python-Levenshtein` library for performance (`pip install python-Levenshtein`)
  - If fewer than 2,048 words pass the filter (unlikely with 5,000+ candidates), lower threshold to ≥ 2 and re-run — document if this occurs
  - Output: `corpus/intermediate/levenshtein-filtered.txt` (2,048+ lines, Arabic)
  - Log all rejected words and the word they were too close to: `corpus/logs/levenshtein-rejections.tsv`
  *Effort: 8h*
  *blocked by: #1.10*

- [ ] **2.2** 🟠 `[DEV]` Write `corpus/scripts/06_phonetic_check.py`. Cross-language homophone/near-homophone detection:
  - Transliterate each word in `corpus/intermediate/levenshtein-filtered.txt` to IPA (use `camel_tools.transliterate` or Buckwalter → IPA mapping)
  - Also transliterate to simplified Latin phonetic spelling
  - For each pair of words, flag if their Latin phonetic representations have Levenshtein distance < 3
  - Output flagged pairs to `corpus/logs/phonetic-collisions.tsv` for human review
  - `[TRANS]` must review all flagged pairs and approve/reject each
  *Effort: 6h*
  *blocked by: #2.1*

- [ ] **2.3** 🟠 `[TRANS]` Review `corpus/logs/phonetic-collisions.tsv`. For each flagged pair:
  - Determine if the two words would be genuinely confusable when spoken aloud in Arabic
  - If yes: mark the lower-ranked word for removal from the candidate pool
  - Document decision in `corpus/logs/phonetic-collision-decisions.tsv`
  *Effort: 4h*
  *blocked by: #2.2*

- [ ] **2.4** 🟠 `[DEV]` Write `corpus/scripts/07_semantic_diversity_score.py`. Compute a semantic diversity metric:
  - Use an Arabic word embedding model (e.g., AraVec or CAMeL Arabic BERT embeddings) to embed all words in the filtered list
  - For each word, compute its average cosine distance to its 10 nearest neighbors in the embedding space
  - Words with higher average distance to neighbors are more semantically distinct
  - Output: `corpus/intermediate/semantic-scores.tsv` (word | embedding_diversity_score)
  - This score feeds into the final ranking in #2.5
  *Effort: 8h*
  *blocked by: #2.1*

- [ ] **2.5** 🔴 `[DEV]` Write `corpus/scripts/08_final_selection.py`. Produce the master 2,048-word list:
  - Input: `corpus/intermediate/levenshtein-filtered.txt`, phonetic-collision removals from #2.3, semantic scores from #2.4
  - Final ranking formula: `score = (0.5 × normalized_freq) + (0.3 × semantic_diversity) + (0.2 × memorability_proxy)`
    - `memorability_proxy` = inverse of character count (shorter = more memorable)
  - Select top 2,048 by score after removing phonetic collisions
  - Output: `corpus/intermediate/final-2048-arabic.txt` — 2,048 lines, sorted by index (0–2047), one Arabic lemma per line
  - Output: `corpus/intermediate/final-2048-with-scores.tsv` — includes all scoring data for auditability
  *Effort: 4h*
  *blocked by: #2.3, #2.4*

- [ ] **2.6** 🟠 `[TRANS]` Human review checklist — review all 2,048 words in `corpus/intermediate/final-2048-arabic.txt`:
  - Confirm no proper nouns slipped through POS filtering
  - Confirm no politically sensitive words
  - Confirm no words that are offensive in Standard Arabic
  - Confirm no words from the `corpus/blocklist.txt` appear
  - Confirm words are genuine Arabic lemmas (not OCR artifacts or encoding errors)
  - Use a spreadsheet review template: `corpus/review/human-review-sheet.xlsx` with columns: `index | word | approve? | rejection_reason`
  - Target: at least 2 independent Arabic-speaking reviewers sign off
  *Effort: 16h (2 reviewers × 8h each)*
  *blocked by: #2.5*

- [ ] **2.7** 🔴 `[DEV]` After human review, apply any substitutions/removals. Re-run `08_final_selection.py` with the updated blocklist. Produce the **frozen** master file:
  - `corpus/bip8192-master-arabic.txt` — exactly 2,048 lines, UTF-8 NFC, no BOM, no header, no trailing whitespace, one word per line, line index = word integer value (0-indexed)
  - Run `validate_candidates.py` one final time to confirm: count == 2048, no dupes, all valid Arabic
  - Compute SHA-256 of this file: `sha256sum corpus/bip8192-master-arabic.txt > corpus/bip8192-master-arabic.txt.sha256`
  - **Once frozen, this file must not change without a major version bump and full wallet migration plan (see §10)**
  *Effort: 3h*
  *blocked by: #2.6*

- [ ] **2.8** 🟠 `[CRYPTO]` Independent cryptographic review of the selection algorithm:
  - Verify that the 2,048-word set provides true 11 bits of entropy per word (i.e., all 2^11 = 2,048 positions are genuinely distinct)
  - Verify no subset of the list forms a predictable pattern that could allow entropy reduction attacks
  - Sign off in `corpus/CRYPTO-REVIEW.md`
  *Effort: 4h*
  *blocked by: #2.7*

---

## 3. Multilingual Mapping System

**Goal:** For each of the 2,048 Arabic words, produce a corresponding word in each target language. Each language gets its own ordered 2,048-line file where line N is the translation of Arabic word N.

---

### 3.1 — Translation Infrastructure

- [ ] **3.1.1** 🔴 `[DEV]` Create directory structure:
  ```
  corpus/translations/
    ar/  en/  ur/  fr/  es/  tr/  id/  fa/  bn/
    de/  ru/  zh-Hans/  zh-Hant/  hi/  ha/  sw/  so/  am/
    ja/  ko/  pt/  it/  nl/  ps/  sd/  kk/  az/  sq/  bs/
  ```
  Each language directory contains: `bip8192-wordlist-{lang}.txt` (final) and `bip8192-wordlist-{lang}-review.tsv` (working review sheet with columns: `index | arabic_source | translation | back_translation | approved? | notes`).
  *Effort: 1h*
  *blocked by: #2.7*

- [ ] **3.1.2** 🟠 `[DEV]` Write `corpus/scripts/09_generate_translation_template.py`:
  - Reads `corpus/bip8192-master-arabic.txt`
  - Produces a TSV template for each language: `corpus/translations/{lang}/review-template.tsv`
  - Columns: `index (0–2047) | arabic | {lang}_machine_translation | back_translation_to_arabic | notes`
  - For machine translation column: use Helsinki-NLP/opus-mt models (HuggingFace) or DeepL API for Tier 1 languages
  *Effort: 4h*
  *blocked by: #3.1.1*

- [ ] **3.1.3** 🟠 `[DEV]` Write `corpus/scripts/10_validate_translation.py` — reusable validator for any language's final word list file:
  - Exactly 2,048 lines
  - No blank lines
  - No duplicate words
  - All words use the correct Unicode block for the language (e.g., Cyrillic for Russian, Devanagari for Hindi)
  - All words are NFC-normalized
  - No word exceeds 20 characters
  - No word is fewer than 2 characters
  - Levenshtein spacing ≥ 2 within the language's own list (minimum; ≥ 3 preferred)
  *Effort: 4h*

---

### 3.2 — Tier 1 Languages (Required at Launch)

- [ ] **3.2.1** 🔴 `[TRANS]` **Arabic (ar)** — The master file IS the Arabic wordlist. Copy `corpus/bip8192-master-arabic.txt` → `corpus/translations/ar/bip8192-wordlist-ar.txt`. Run validation. This is trivially done but must be an explicit step so the ar file is in the standard location.
  *Effort: 0.5h*
  *blocked by: #2.7*

- [ ] **3.2.2** 🔴 `[TRANS]` **English (en)** — Translation strategy:
  - Step 1: Machine-translate all 2,048 Arabic lemmas to English using DeepL API (or GPT-4 with explicit "translate this single Arabic word to its most common English equivalent, single word only" prompt) → fills the machine column in `review-template.tsv`
  - Step 2: Native English speaker + Arabic bilingual reviewer audits all 2,048 rows
  - Step 3: For each English candidate word, check: (a) single word, (b) no hyphens, (c) unambiguous part of speech when read in isolation, (d) no offensive meaning in English, (e) Levenshtein ≥ 3 from all other English words in the list (run #10_validate_translation.py with strict mode)
  - Step 4: For any word that fails, substitute with a synonym that passes
  - Output encoding: UTF-8, Latin script, all lowercase, NFC
  *Effort: 24h*
  *blocked by: #3.1.2*

- [ ] **3.2.3** 🔴 `[TRANS]` **Urdu (ur)** — Translation strategy:
  - Script: Nastaliq/Perso-Arabic (U+0600–U+06FF, U+0750–U+077F, U+FB50–U+FDFF, U+FE70–U+FEFF)
  - Note: Many Arabic source words are cognates in Urdu — must verify the Urdu word is semantically equivalent in Urdu context, not just a borrowed Arabic term that has shifted meaning
  - Machine translation first pass using a dedicated Arabic→Urdu model or GPT-4
  - Human review by native Urdu speaker (Pakistan-standard Urdu)
  - Normalize output to NFC
  - RTL layout validation: confirm words display correctly in RTL rendering test (`corpus/tests/rtl_render_test.html`)
  *Effort: 32h*
  *blocked by: #3.1.2*

- [ ] **3.2.4** 🔴 `[TRANS]` **French (fr)** — Translation strategy:
  - Machine translation via DeepL API (Arabic → French)
  - Human review by native French speaker
  - Enforce: all words lowercase, no accented character confusion (e.g., é vs è vs ê — ensure each word's accent is consistent and correct)
  - Check for false friends / offensive double meanings in French slang
  - Levenshtein ≥ 3 enforced across the entire French list
  *Effort: 20h*
  *blocked by: #3.1.2*

- [ ] **3.2.5** 🔴 `[TRANS]` **Spanish (es)** — Translation strategy:
  - Machine translation via DeepL API
  - Human review by native Spanish speaker (use pan-Latin American Spanish vocabulary where possible to avoid regional terms)
  - Enforce: all words lowercase, NFC normalization (ñ, á, é, í, ó, ú handled correctly)
  - Check for offensive double meanings across major Spanish-speaking regions (Spain, Mexico, Argentina)
  *Effort: 20h*
  *blocked by: #3.1.2*

- [ ] **3.2.6** 🔴 `[TRANS]` **Turkish (tr)** — Translation strategy:
  - Machine translation first pass
  - Human review by native Turkish speaker
  - Turkish uses Latin script with special characters: ç, ğ, ı, İ, ö, ş, ü — all must be correctly encoded UTF-8 NFC lowercase
  - Note: Turkish vowel harmony means the same Arabic concept may map to different Turkish words depending on grammatical context — always prefer the **noun** or **verbal noun (mastar)** form
  *Effort: 20h*
  *blocked by: #3.1.2*

- [ ] **3.2.7** 🔴 `[TRANS]` **Indonesian/Malay (id/ms)** — Translation strategy:
  - Produce two files: `bip8192-wordlist-id.txt` and `bip8192-wordlist-ms.txt`
  - Many Arabic words are direct loanwords in Indonesian/Malay — flag these; they can often be used as-is in Romanized form
  - Human review: one Indonesian reviewer + one Malaysian reviewer
  - Both files use Latin script, UTF-8, lowercase, NFC
  - Note differences in spelling conventions (id vs ms orthography): document divergences in `corpus/translations/id/NOTES.md`
  *Effort: 28h (both files)*
  *blocked by: #3.1.2*

- [ ] **3.2.8** 🔴 `[TRANS]` **Persian/Farsi (fa)** — Translation strategy:
  - Script: Perso-Arabic (same Unicode range as Arabic + Farsi-specific chars: پ چ ژ گ)
  - Many Arabic source words are used in Persian — verify the Persian meaning has not diverged
  - Human review by native Farsi speaker (Iran-standard)
  - RTL rendering test required
  - NFC normalization, use Arabic Presentation Forms only where unavoidable (prefer base characters)
  *Effort: 24h*
  *blocked by: #3.1.2*

- [ ] **3.2.9** 🔴 `[TRANS]` **Bengali (bn)** — Translation strategy:
  - Script: Bengali (U+0980–U+09FF)
  - Machine translation first pass (Arabic → Bengali via intermediate English if needed)
  - Human review by native Bengali speaker (use standard Modern Standard Bengali)
  - NFC normalization; verify hasanta (U+09CD) usage is consistent
  - Levenshtein ≥ 2 (minimum acceptable given script complexity) enforced
  *Effort: 24h*
  *blocked by: #3.1.2*

---

### 3.3 — Tier 2 Languages (Before Mainnet)

For each Tier 2 language, the workflow is: machine translation → human review by native speaker → `10_validate_translation.py` → final file. Specific notes per language:

- [ ] **3.3.1** 🟠 `[TRANS]` **German (de)** — Latin script, NFC. Watch for compound nouns — German compounds can be very long; prefer short standalone nouns (≤ 12 chars). Enforce lowercase. *Effort: 20h* · *blocked by: #3.1.2*

- [ ] **3.3.2** 🟠 `[TRANS]` **Russian (ru)** — Cyrillic (U+0400–U+04FF). NFC normalization. Human review by native speaker. Enforce all-lowercase Cyrillic. Levenshtein ≥ 3. *Effort: 20h* · *blocked by: #3.1.2*

- [ ] **3.3.3** 🟠 `[TRANS]` **Chinese Simplified (zh-Hans)** — CJK Unicode block. Each "word" should be a 1–2 character CJK word that represents the Arabic concept. Do NOT use multi-character phrases — single or double character only. Human review by native Mandarin speaker (PRC standard). NFC. *Effort: 24h* · *blocked by: #3.1.2*

- [ ] **3.3.4** 🟠 `[TRANS]` **Chinese Traditional (zh-Hant)** — Same as zh-Hans but using Traditional characters (Taiwan/Hong Kong standard). Human review by native Traditional Chinese reader. Verify each word differs from zh-Hans mapping where appropriate. *Effort: 12h (diff from zh-Hans)* · *blocked by: #3.3.3*

- [ ] **3.3.5** 🟠 `[TRANS]` **Hindi (hi)** — Devanagari script (U+0900–U+097F). NFC normalization. Many Arabic loanwords exist in Hindi via Urdu influence — prefer native Sanskrit-root Hindi equivalents where available for distinctiveness. Human review by native Hindi speaker. *Effort: 20h* · *blocked by: #3.1.2*

- [ ] **3.3.6** 🟠 `[TRANS]` **Hausa (ha)** — Latin script with tone marks (use NFC). Hausa has significant Arabic loanword vocabulary — prefer native Hausa terms for distinctiveness; fall back to loanwords only if no equivalent exists. Human review by native Hausa speaker. *Effort: 24h* · *blocked by: #3.1.2*

- [ ] **3.3.7** 🟠 `[TRANS]` **Swahili (sw)** — Latin script, NFC. Swahili noun class prefixes may need to be stripped to get bare root words (e.g., prefer `kitabu → tabu` form if shorter and unambiguous). Human review. *Effort: 20h* · *blocked by: #3.1.2*

- [ ] **3.3.8** 🟠 `[TRANS]` **Somali (so)** — Latin script with special characters (ɓ, ɗ, X̃, etc. — use standard Somali orthography). Human review by native Somali speaker. *Effort: 24h* · *blocked by: #3.1.2*

- [ ] **3.3.9** 🟠 `[TRANS]` **Amharic (am)** — Ethiopic/Ge'ez script (U+1200–U+137F). Each word should be a single Ethiopic grapheme cluster representing one concept. Human review by native Amharic speaker. NFC. *Effort: 24h* · *blocked by: #3.1.2*

---

### 3.4 — Tier 3 Languages (Post-Launch)

All follow the same machine → human → validate workflow. Collect machine translations now during Tier 1 work to amortize costs:

- [ ] **3.4.1** 🟡 `[TRANS]` **Japanese (ja)** — Use hiragana or kanji+hiragana. Prefer kanji for semantic distinctiveness. 1–2 kanji per word. Human review. *Effort: 24h* · *blocked by: #3.1.2*
- [ ] **3.4.2** 🟡 `[TRANS]` **Korean (ko)** — Hangul script. 1–2 syllable blocks. Human review. *Effort: 20h*
- [ ] **3.4.3** 🟡 `[TRANS]` **Portuguese (pt)** — Latin, NFC, lowercase. Prefer pan-Portuguese (avoid Brazil/Portugal divergence where possible; document divergences). *Effort: 16h*
- [ ] **3.4.4** 🟡 `[TRANS]` **Italian (it)** — Latin, NFC, lowercase. *Effort: 16h*
- [ ] **3.4.5** 🟡 `[TRANS]` **Dutch (nl)** — Latin, NFC, lowercase. Watch for compound words (same as German). *Effort: 16h*
- [ ] **3.4.6** 🟡 `[TRANS]` **Pashto (ps)** — Perso-Arabic script, RTL, NFC. Significant Arabic loanwords. Human review. *Effort: 24h*
- [ ] **3.4.7** 🟡 `[TRANS]` **Sindhi (sd)** — Perso-Arabic script (Sindhi has extended Arabic chars), RTL, NFC. Human review. *Effort: 24h*
- [ ] **3.4.8** 🟡 `[TRANS]` **Kazakh (kk)** — Use Cyrillic (Kazakhstan standard as of current transition state; document if Latin script adoption changes this). *Effort: 20h*
- [ ] **3.4.9** 🟡 `[TRANS]` **Azerbaijani (az)** — Latin script (post-Soviet standard). NFC. *Effort: 16h*
- [ ] **3.4.10** 🟡 `[TRANS]` **Albanian (sq)** — Latin script, NFC, special chars (ë, ç). *Effort: 16h*
- [ ] **3.4.11** 🟡 `[TRANS]` **Bosnian (bs)** — Latin script (Bosnian standard), NFC, diacritics (č, ć, dž, đ, š, ž). *Effort: 16h*

---

### 3.5 — Cross-Language Quality Gates

- [ ] **3.5.1** 🔴 `[DEV]` Write `corpus/scripts/11_cross_lang_collision_check.py`:
  - For each pair of languages that share a script (e.g., Arabic/Urdu/Persian/Pashto/Sindhi all use Perso-Arabic), check that no word at index N in language A is identical to the word at index M (M ≠ N) in language B
  - This prevents cross-language collision where the same string maps to two different seed words
  - Log all collisions to `corpus/logs/cross-lang-collisions.tsv`
  *Effort: 4h*
  *blocked by: all language files complete*

- [ ] **3.5.2** 🟠 `[TRANS]` Review and resolve all cross-language collisions flagged by #3.5.1. Substitute one of the colliding words. Re-run validation.
  *Effort: 4h*
  *blocked by: #3.5.1*

---

## 4. File Format & Schema

---

- [ ] **4.1** 🔴 `[DEV]` Finalize and document the **canonical file format** in `corpus/FORMAT.md`:
  ```
  File name:      bip8192-wordlist-{IETF_lang_tag}.txt
  Encoding:       UTF-8, no BOM
  Line endings:   LF only (\n), no CRLF
  Normalization:  NFC (Unicode Canonical Decomposition, followed by Canonical Composition)
  Content:        Exactly 2,048 lines
                  One word per line
                  No trailing whitespace
                  No blank lines
                  No header line or comment lines
                  Line 0 = word with integer value 0 (first line of file = word 0)
  ```
  *Effort: 1h*

- [ ] **4.2** 🔴 `[DEV]` Write `corpus/scripts/12_build_json_index.py`:
  - Reads all completed `bip8192-wordlist-{lang}.txt` files
  - Produces `bip8192-index.json` with structure:
    ```json
    {
      "version": "1.0.0",
      "generated": "ISO-8601 timestamp",
      "languages": {
        "ar": { "word_to_index": {"كلمة": 0, ...}, "index_to_word": {"0": "كلمة", ...} },
        "en": { "word_to_index": {...}, "index_to_word": {...} },
        ...
      }
    }
    ```
  - Note: `index_to_word` keys are strings (JSON keys must be strings) but represent integers 0–2047
  - This file is used by wallet implementations for O(1) word lookup
  *Effort: 4h*
  *blocked by: all Tier 1 language files complete*

- [ ] **4.3** 🔴 `[DEV]` Write `corpus/scripts/13_build_manifest.py`:
  - Reads all `bip8192-wordlist-*.txt` files and `bip8192-index.json`
  - Computes SHA-256 of each file
  - Produces `bip8192-manifest.json`:
    ```json
    {
      "bip": "8192",
      "chain": "Chain 8192",
      "version": "1.0.0",
      "released": "ISO-8601 date",
      "word_count": 2048,
      "encoding": "UTF-8 NFC",
      "files": {
        "bip8192-wordlist-ar.txt": {
          "sha256": "abc123...",
          "lang": "ar",
          "script": "Arabic",
          "direction": "rtl",
          "tier": 1,
          "status": "released"
        },
        ...
      },
      "index_file": {
        "filename": "bip8192-index.json",
        "sha256": "def456..."
      }
    }
    ```
  *Effort: 3h*
  *blocked by: #4.2*

- [ ] **4.4** 🔴 `[DEV]` Write `corpus/scripts/14_verify_manifest.py` — runtime integrity checker:
  - Given a directory of wordlist files and a manifest, recompute SHA-256 of each file and compare to manifest
  - Exit code 0 = all files intact; exit code 1 = any mismatch
  - This script is called by wallet apps at startup before loading any wordlist
  *Effort: 2h*
  *blocked by: #4.3*

- [ ] **4.5** 🔴 `[PM]` Storage security:
  - All wordlist files, `bip8192-index.json`, and `bip8192-manifest.json` stored **only** in the private `bucks-wordlist` repo
  - Access restricted to: core team members with signed NDA
  - Enable 2FA enforcement on the private repo
  - Set up branch protection: no direct pushes to `main`; require 2 approvals for any merge
  - Never push wordlist files to `bucks-browser`, `bucks-mobile`, or any other public repo
  *Effort: 2h*

---

## 5. Integration with bucks-browser Wallet Code

**Files:** `src/services/WalletService.ts` · `src/lib/bip8192.ts`

---

- [ ] **5.1** 🔴 `[DEV]` **CRITICAL BUG FIX — PBKDF2 iterations:**
  In `src/lib/bip8192.ts`, locate the PBKDF2 call used to derive the seed from the mnemonic. Change the iterations parameter from `2048` → `310000`. This is not a refactor, it is a security fix. The current value provides insufficient key stretching.
  ```typescript
  // BEFORE (insecure):
  pbkdf2(mnemonic, salt, 2048, 64, 'sha512')
  // AFTER (correct per current NIST guidance):
  pbkdf2(mnemonic, salt, 310000, 64, 'sha512')
  ```
  **Warning:** Changing this value invalidates all wallets generated before the fix. This change must be coordinated with a wallet migration guide. Do NOT ship this without coordinating with #10.1.
  *Effort: 1h (fix is trivial; coordination is critical)*

- [ ] **5.2** 🔴 `[DEV]` Create `src/lib/wordlist-loader.ts`:
  - `loadWordlist(lang: string): Promise<string[]>` — async function that:
    1. Fetches the wordlist file for the given language code from `assets/wordlists/bip8192-wordlist-{lang}.txt`
    2. Calls the SHA-256 integrity check against the bundled manifest (see #5.3) before returning
    3. Returns an array of exactly 2,048 strings indexed 0–2047
    4. Throws `WordlistIntegrityError` if SHA-256 mismatch
    5. Throws `WordlistNotFoundError` if the language is not supported
    6. Caches loaded wordlists in memory (Map<lang, string[]>) — do not re-fetch on every call
  *Effort: 6h*
  *blocked by: #4.4*

- [ ] **5.3** 🔴 `[DEV]` Bundle `bip8192-manifest.json` into the browser app at `assets/wordlists/bip8192-manifest.json`. This file is the source of truth for SHA-256 hashes. Update the build pipeline (webpack/vite config) to:
  - Include `assets/wordlists/bip8192-manifest.json` in the build output
  - Include `assets/wordlists/bip8192-wordlist-{lang}.txt` for all supported languages in the build output
  - Ensure these files are NOT publicly listable (no directory index served)
  *Effort: 3h*
  *blocked by: #4.3*

- [ ] **5.4** 🔴 `[DEV]` Rewrite the `generateMnemonic` function in `src/lib/bip8192.ts`:
  ```typescript
  async function generateMnemonic(
    strength: 128 | 160 | 192 | 224 | 256 = 256,
    lang: SupportedLang = 'en'
  ): Promise<string>
  ```
  - `strength = 256` → 24-word mnemonic (preferred for Chain 8192 — enforce this as the default)
  - Uses `crypto.getRandomValues()` for entropy (Web Crypto API — NOT Math.random())
  - Applies BIP-8192 checksum: append `(strength / 32)` bits of SHA-256(entropy) to the entropy, then split into 11-bit groups, each group indexes into the wordlist
  - Loads wordlist via `loadWordlist(lang)`
  - Returns space-separated string of words in the requested language
  *Effort: 8h*
  *blocked by: #5.2*

- [ ] **5.5** 🔴 `[DEV]` Rewrite `validateMnemonic` in `src/lib/bip8192.ts`:
  ```typescript
  async function validateMnemonic(
    mnemonic: string,
    lang: SupportedLang = 'en'
  ): Promise<boolean>
  ```
  - Trims and splits the mnemonic string on whitespace (handle both regular space U+0020 and ZWSP U+200B and NBSP U+00A0)
  - Checks word count is 12, 15, 18, 21, or 24
  - Loads wordlist for lang, verifies every word exists in the list
  - Reconstructs bit string, verifies checksum matches
  - Returns true only if all checks pass — never throw; return false on any failure
  *Effort: 6h*
  *blocked by: #5.2*

- [ ] **5.6** 🔴 `[DEV]` Write `mnemonicToSeed` in `src/lib/bip8192.ts`:
  ```typescript
  async function mnemonicToSeed(
    mnemonic: string,
    passphrase: string = '',
    lang: SupportedLang = 'en'
  ): Promise<Uint8Array>
  ```
  - Validates mnemonic first (call `validateMnemonic`)
  - Normalize mnemonic: Unicode NFKD, lowercase, trim whitespace between words to single space
  - Normalize passphrase: Unicode NFKD
  - Salt = `"bip8192mnemonic" + passphrase` (note "bip8192mnemonic" prefix, not "mnemonic" — differentiates from BIP-39)
  - PBKDF2: SHA-512, **310,000 iterations**, 64-byte output (see #5.1)
  - Returns raw 64-byte seed as Uint8Array
  *Effort: 4h*
  *blocked by: #5.1, #5.2*

- [ ] **5.7** 🟠 `[DEV]` Write `detectWordlistLanguage` in `src/lib/bip8192.ts`:
  ```typescript
  async function detectWordlistLanguage(
    words: string[]
  ): Promise<SupportedLang | null>
  ```
  - For each supported language, check if ALL words in the input array exist in that language's wordlist
  - Return the first matching language code
  - Return `null` if no language matches all words
  - Load wordlists lazily (only load each language's index as needed)
  - Optimization: check word count first; if not 12/15/18/21/24, return null immediately
  *Effort: 4h*
  *blocked by: #5.2*

- [ ] **5.8** 🟠 `[DEV]` Define `SupportedLang` TypeScript union type in `src/types/bip8192.ts`:
  ```typescript
  export type SupportedLang = 'ar' | 'en' | 'ur' | 'fr' | 'es' | 'tr' |
    'id' | 'ms' | 'fa' | 'bn' | 'de' | 'ru' | 'zh-Hans' | 'zh-Hant' |
    'hi' | 'ha' | 'sw' | 'so' | 'am' | 'ja' | 'ko' | 'pt' | 'it' |
    'nl' | 'ps' | 'sd' | 'kk' | 'az' | 'sq' | 'bs';
  export const SUPPORTED_LANGS: SupportedLang[] = [...];
  export const TIER1_LANGS: SupportedLang[] = ['ar','en','ur','fr','es','tr','id','ms','fa','bn'];
  ```
  *Effort: 1h*

- [ ] **5.9** 🟠 `[DEV]` Add a language selector component `src/components/LanguageSelector.tsx` that exposes the language choice to `generateMnemonic`. Pass the selected language down through context (use React context or Zustand store — whichever is the existing pattern in bucks-browser). Default: `'en'` until the user explicitly changes it.
  *Effort: 4h*
  *blocked by: #5.8*

---

## 6. Integration with bucks-mobile

---

### 6.1 — Android (Kotlin)

- [ ] **6.1.1** 🔴 `[DEV]` Create `app/src/main/kotlin/com/chain8192/bucks/crypto/BIP8192WordList.kt`:
  ```kotlin
  object BIP8192WordList {
    private val cache = mutableMapOf<String, List<String>>()

    fun load(context: Context, lang: String = "en"): List<String> {
      return cache.getOrPut(lang) {
        val filename = "wordlists/bip8192-wordlist-$lang.txt"
        context.assets.open(filename).bufferedReader().readLines()
          .also { require(it.size == 2048) { "Wordlist $lang has ${it.size} words, expected 2048" } }
      }
    }

    fun wordToIndex(word: String, lang: String = "en", context: Context): Int? {
      return load(context, lang).indexOf(word).takeIf { it >= 0 }
    }

    fun indexToWord(index: Int, lang: String = "en", context: Context): String {
      require(index in 0..2047)
      return load(context, lang)[index]
    }

    fun supportedLangs(): List<String> = listOf("ar","en","ur","fr","es","tr","id","ms","fa","bn")
  }
  ```
  *Effort: 4h*

- [ ] **6.1.2** 🔴 `[DEV]` Add wordlist files to Android assets:
  - Place all Tier 1 `bip8192-wordlist-{lang}.txt` files under `app/src/main/assets/wordlists/`
  - Add `bip8192-manifest.json` under `app/src/main/assets/wordlists/`
  - **Add `app/src/main/assets/wordlists/` to `.gitignore`** if the Android repo is or might become public
  - Update `build.gradle` to compress assets with `aaptOptions { noCompress "txt" "json" }` to avoid double-compression
  *Effort: 2h*

- [ ] **6.1.3** 🟠 `[DEV]` Implement SHA-256 integrity check in `BIP8192WordList.kt`:
  - On first load of any wordlist, read `bip8192-manifest.json` from assets
  - Compute SHA-256 of the loaded file content
  - Compare against manifest entry — throw `WordlistIntegrityException` if mismatch
  - Use `java.security.MessageDigest.getInstance("SHA-256")`
  *Effort: 3h*
  *blocked by: #6.1.1*

- [ ] **6.1.4** 🟠 `[DEV]` Implement locale-based default language detection in Android:
  ```kotlin
  fun defaultLang(): String {
    val locale = Locale.getDefault().language
    return when (locale) {
      "ar" -> "ar"
      "ur" -> "ur"
      "fr" -> "fr"
      "es" -> "es"
      "tr" -> "tr"
      "id", "ms" -> "id"
      "fa" -> "fa"
      "bn" -> "bn"
      else -> "en"
    }
  }
  ```
  *Effort: 1h*

---

### 6.2 — iOS (Swift)

- [ ] **6.2.1** 🔴 `[DEV]` Create `BucksWallet/Crypto/BIP8192WordList.swift`:
  ```swift
  final class BIP8192WordList {
    static let shared = BIP8192WordList()
    private var cache: [String: [String]] = [:]
    private let queue = DispatchQueue(label: "com.chain8192.wordlist", attributes: .concurrent)

    func load(lang: String = "en") throws -> [String] {
      if let cached = cache[lang] { return cached }
      guard let url = Bundle.main.url(forResource: "bip8192-wordlist-\(lang)", withExtension: "txt", subdirectory: "wordlists")
        else { throw BIP8192Error.wordlistNotFound(lang) }
      let content = try String(contentsOf: url, encoding: .utf8)
      let words = content.components(separatedBy: "\n").filter { !$0.isEmpty }
      guard words.count == 2048 else { throw BIP8192Error.invalidWordlistCount(words.count) }
      try verifyIntegrity(words: words, lang: lang)
      queue.async(flags: .barrier) { self.cache[lang] = words }
      return words
    }
  }
  ```
  *Effort: 6h*

- [ ] **6.2.2** 🔴 `[DEV]` Add wordlist files to iOS Bundle:
  - Create a `wordlists/` folder in the Xcode project (Add Files → Create groups)
  - Add all Tier 1 `bip8192-wordlist-{lang}.txt` files and `bip8192-manifest.json`
  - Ensure they are in the "Copy Bundle Resources" build phase
  - **Do NOT add the wordlists folder to any public git repo** — add to `.gitignore`
  *Effort: 2h*

- [ ] **6.2.3** 🟠 `[DEV]` Implement SHA-256 integrity verification in `BIP8192WordList.swift`:
  - Use `CryptoKit.SHA256.hash(data:)` (iOS 13+)
  - Read `bip8192-manifest.json` from bundle on first load
  - Verify each loaded wordlist file's hash against manifest before returning
  *Effort: 3h*
  *blocked by: #6.2.1*

- [ ] **6.2.4** 🟠 `[DEV]` Implement locale-based default language detection in iOS:
  ```swift
  static func defaultLang() -> String {
    let lang = Locale.current.language.languageCode?.identifier ?? "en"
    let supported = ["ar","ur","fr","es","tr","id","ms","fa","bn"]
    return supported.contains(lang) ? lang : "en"
  }
  ```
  *Effort: 1h*

---

## 7. UX / Onboarding Flow

---

- [ ] **7.1** 🟠 `[UX]` Design the **Language Picker** screen (shown on first launch, before seed generation):
  - Title: "Choose your phrase language"
  - Subtitle: "Your 24-word recovery phrase will appear in this language. You can change this anytime before generating a new wallet."
  - List: all Tier 1 supported languages with native name + English name (e.g., "العربية · Arabic")
  - Search bar to filter the list
  - Currently selected language highlighted
  - "Continue" CTA
  - Language choice stored in secure device preferences (not in the seed/wallet — it's a display preference)
  *Effort: 8h (design)*

- [ ] **7.2** 🟠 `[DEV]` Implement Language Picker screen in bucks-browser (`src/pages/LanguagePicker.tsx`) and bucks-mobile (Android: `LanguagePickerActivity.kt`, iOS: `LanguagePickerViewController.swift`).
  *Effort: 12h (all three platforms)*
  *blocked by: #7.1*

- [ ] **7.3** 🔴 `[UX]` Design the **Mnemonic Display** screen:
  - Show 24 words in a 4×6 or 6×4 grid
  - For RTL languages (ar, ur, fa, ps, sd): render grid RTL, use RTL-aware font (Noto Naskh Arabic, Scheherazade New, or Amiri — all open-source)
  - For LTR languages: render grid LTR
  - Each word cell shows: word number (1–24) + the word in the selected language
  - Font size minimum 18px for Arabic/Urdu scripts (Arabic script is harder to read at small sizes)
  - "Copy phrase" button — copies the space-separated phrase to clipboard, then clears clipboard after 60 seconds
  - "I've saved my phrase" confirm button — requires user to re-enter all 24 words before proceeding
  *Effort: 12h (design)*

- [ ] **7.4** 🟠 `[DEV]` Implement Mnemonic Display screen across all three platforms.
  *Effort: 16h*
  *blocked by: #7.3*

- [ ] **7.5** 🔴 `[UX]` Design the **BIP-8192 vs BIP-39 incompatibility warning** screen:
  - Shown once during wallet creation, before displaying the seed phrase
  - Title: "Your phrase uses BIP-8192"
  - Body: "This recovery phrase is unique to Chain 8192 and the BUCKS token. It CANNOT be used to restore a wallet in apps that use standard BIP-39 phrases (such as MetaMask, Trust Wallet, or Ledger Live). Do not enter this phrase into any other wallet app."
  - Large warning icon (⚠️ or custom)
  - "I understand" checkbox must be checked before continuing
  *Effort: 4h (design)*

- [ ] **7.6** 🟠 `[DEV]` Implement the BIP-8192 incompatibility warning screen across all three platforms.
  *Effort: 6h*
  *blocked by: #7.5*

- [ ] **7.7** 🟠 `[DEV]` Implement **mnemonic import with auto-detection**:
  - User pastes or types their phrase
  - Call `detectWordlistLanguage(words)` — if a match is found, display "Detected language: [Language]" and proceed
  - If no match, display "We couldn't identify the language of this phrase. Please select it manually." → show language picker
  - After language detected/selected, call `validateMnemonic(mnemonic, lang)` — if invalid, display specific error: "Word N '[word]' was not recognized in [Language]."
  *Effort: 8h*
  *blocked by: #5.7*

- [ ] **7.8** 🟠 `[UX]` Design RTL test pass — review all screens in Arabic, Urdu, and Persian layouts on both iOS and Android. Confirm:
  - Word grid renders RTL
  - Number labels for each word still flow correctly (numbers remain LTR within RTL context)
  - CTA buttons are correctly mirrored
  - No text truncation in RTL mode
  *Effort: 6h (QA/design)*
  *blocked by: #7.4*

---

## 8. Security & Privacy

---

- [ ] **8.1** 🔴 `[DEV]` Audit all three codebases (bucks-browser, bucks-mobile Android, bucks-mobile iOS) for any instance where a mnemonic phrase or any portion of it is:
  - Logged to console or a logging framework
  - Included in analytics events
  - Sent to any remote server (crash reporting, telemetry, etc.)
  - Stored in plaintext in local storage, SharedPreferences, or NSUserDefaults
  Create a checklist report: `docs/security/mnemonic-log-audit.md`. Zero findings required before launch.
  *Effort: 8h*

- [ ] **8.2** 🔴 `[DEV]` Add the following to `.gitignore` in every repo that touches wordlist files:
  ```gitignore
  # BIP-8192 Soul Wordlist — proprietary, never public
  bip8192-wordlist-*.txt
  bip8192-index.json
  bip8192-manifest.json
  corpus/
  assets/wordlists/
  app/src/main/assets/wordlists/
  wordlists/
  ```
  Also add a `pre-commit` hook that scans staged files for any line matching `bip8192-wordlist` and aborts if found. Document how to install the hook in `CONTRIBUTING.md`.
  *Effort: 2h*

- [ ] **8.3** 🔴 `[DEV]` Implement **wordlist integrity verification** at app startup (all platforms):
  - Before any wallet function is available, verify all loaded wordlist files' SHA-256 against `bip8192-manifest.json`
  - If verification fails: display a blocking error screen "Wallet data integrity check failed. Please reinstall the app." with a link to the official download
  - Do NOT allow the app to proceed if any wordlist file is corrupt or missing
  *Effort: 4h per platform = 12h total*
  *blocked by: #4.4, #5.3, #6.1.3, #6.2.3*

- [ ] **8.4** 🟠 `[DEV]` Wordlist distribution mechanism (avoid bundling in app store binary):
  - The wordlist files are large and proprietary — bundling them in the app store binary risks extraction
  - **Preferred approach:** Deliver wordlist files via a signed, encrypted update package fetched from a Chain 8192-controlled CDN on first launch, over HTTPS with certificate pinning
  - The app store binary contains only: the `bip8192-manifest.json` (for hash verification) and the English wordlist as a bootstrap fallback
  - All other language wordlist files are downloaded on demand when a user selects that language
  - Each downloaded file is verified against the manifest SHA-256 before being written to the encrypted app sandbox
  *Effort: 24h (design + implementation)*

- [ ] **8.5** 🔴 `[CRYPTO]` Commission a third-party cryptographic security audit before mainnet. Scope must include:
  - BIP-8192 entropy generation (`crypto.getRandomValues` usage)
  - PBKDF2 parameters (iterations, salt, output length)
  - HD key derivation from BIP-8192 seed (BIP-32 compatibility layer if applicable)
  - Wordlist entropy analysis (are all 2,048 words truly distinct enough?)
  - Side-channel considerations in mnemonic display and input
  Estimated cost: $15,000–$40,000. Schedule at least 6 weeks before mainnet.
  *Effort: 2h (coordination) + external engagement*

- [ ] **8.6** 🟠 `[CRYPTO]` Implement **clipboard auto-clear** after mnemonic copy:
  - Browser: after writing to clipboard, start a 60-second countdown, then call `navigator.clipboard.writeText('')` to clear
  - Android: use `ClipboardManager` + Handler with 60s delay to clear
  - iOS: `UIPasteboard.general.items = []` after 60 seconds via DispatchQueue.main.asyncAfter
  - Show a visible countdown timer to the user: "Clipboard will clear in [N]s"
  *Effort: 4h*

- [ ] **8.7** 🟠 `[DEV]` Disable screenshot capture on the mnemonic display screen:
  - Android: `window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)` on the mnemonic activity
  - iOS: `isSecureTextEntry = true` on the mnemonic view, or overlay an opaque view when `UIApplicationUserDidTakeScreenshotNotification` fires
  - Browser: no reliable prevention; display a warning that screenshots are not recommended
  *Effort: 3h*

---

## 9. Testing Plan

---

- [ ] **9.1** 🔴 `[DEV]` Write unit test `tests/unit/test_wordlist_properties.py` (Python, for the corpus pipeline):
  ```
  test_word_count_exactly_2048()
  test_no_duplicate_words()
  test_all_arabic_unicode()
  test_nfc_normalized()
  test_levenshtein_min_distance_3()    # O(n²) — run once, cache results
  test_no_word_shorter_than_3_chars()
  test_no_word_longer_than_12_chars()
  test_sha256_matches_manifest()
  ```
  All tests must pass before any wordlist is considered final.
  *Effort: 6h*
  *blocked by: #2.7*

- [ ] **9.2** 🔴 `[DEV]` Write unit test `tests/unit/bip8192.test.ts` (TypeScript, for bucks-browser):
  ```
  generateMnemonic_returns_24_words_by_default()
  generateMnemonic_uses_crypto_getRandomValues()
  generateMnemonic_strength_128_returns_12_words()
  validateMnemonic_rejects_wrong_word_count()
  validateMnemonic_rejects_unknown_words()
  validateMnemonic_rejects_bad_checksum()
  validateMnemonic_accepts_valid_mnemonic()
  mnemonicToSeed_uses_310000_iterations()
  mnemonicToSeed_is_deterministic()
  mnemonicToSeed_different_passphrase_different_seed()
  detectWordlistLanguage_detects_arabic()
  detectWordlistLanguage_detects_english()
  detectWordlistLanguage_returns_null_for_unknown()
  ```
  *Effort: 8h*
  *blocked by: #5.1–#5.7*

- [ ] **9.3** 🔴 `[DEV]` Write integration test `tests/integration/test_round_trip.ts`:
  - Generate a mnemonic with `generateMnemonic(256, 'en')`
  - Call `mnemonicToSeed(mnemonic)` → get seed bytes
  - Derive HD wallet at `m/44'/8192'/0'/0/0`
  - Verify the derived address matches an expected fixed test vector
  - Repeat for Arabic, Urdu, French, Spanish (same entropy, different language → same seed because mnemonic is normalized before PBKDF2)
  *Effort: 6h*
  *blocked by: #9.2*

- [ ] **9.4** 🔴 `[DEV]` Cross-platform determinism test:
  - Define 5 fixed test vectors: `{entropy_hex, mnemonic_en, mnemonic_ar, expected_seed_hex, expected_address}`
  - Implement the test on all three platforms (browser TypeScript, Android Kotlin, iOS Swift)
  - All three must produce identical `expected_seed_hex` and `expected_address` from the same `entropy_hex`
  - This test must be run before every release
  *Effort: 12h*
  *blocked by: #5.6, #6.1.1, #6.2.1*

- [ ] **9.5** 🟠 `[DEV]` Entropy coverage test:
  - For all 2,048 possible values of each 11-bit group (0–2047), verify that:
    - `wordlist[i]` exists and is non-empty
    - Encoding index `i` to a word and decoding back gives `i`
  - Run for all supported languages
  *Effort: 3h*
  *blocked by: #5.2*

- [ ] **9.6** 🟠 `[DEV]` Write regression test `tests/regression/test_wordlist_frozen.py`:
  - After the wordlist is finalized (v1.0.0), compute SHA-256 of `bip8192-master-arabic.txt` and all Tier 1 language files
  - Store these hashes in `tests/regression/known-good-hashes.json`
  - The regression test reads this file and verifies current files match — any deviation is a test failure
  - This test prevents accidental word list changes that would invalidate existing wallets
  *Effort: 2h*
  *blocked by: #2.7, all Tier 1 translation files*

- [ ] **9.7** 🟠 `[DEV]` PBKDF2 performance test: on a reference device (mid-range Android, iPhone SE), measure time to complete `mnemonicToSeed` with 310,000 iterations. Expected: 1–4 seconds. If > 5 seconds on the reference device, investigate offloading to a background thread with a progress indicator. Document benchmark results in `docs/performance/pbkdf2-benchmark.md`.
  *Effort: 4h*
  *blocked by: #5.6*

- [ ] **9.8** 🟡 `[DEV]` Fuzz test `validateMnemonic`:
  - Feed 10,000 randomly generated strings to `validateMnemonic`
  - Assert: function always returns boolean (never throws), execution time always < 500ms
  *Effort: 3h*

---

## 10. Release & Governance

---

- [ ] **10.1** 🔴 `[PM]` `[DEV]` Write the **PBKDF2 migration plan** before shipping the fix from #5.1:
  - Determine if any wallets have already been created with the 2,048-iteration bug
  - If yes: design a migration UX — ask users to export their key, re-derive with 310,000 iterations, confirm new address, and update stored data
  - If no wallets exist yet (testnet only): document that all testnet wallets are invalidated and must be recreated
  - Document in `docs/migration/pbkdf2-migration-v1.md`
  *Effort: 8h*

- [ ] **10.2** 🔴 `[PM]` Establish **word list versioning policy** in `corpus/GOVERNANCE.md`:
  - Word list version follows semver: `v{MAJOR}.{MINOR}.{PATCH}`
  - **PATCH:** Never allowed — changing even one word is a breaking change
  - **MINOR:** Adding new language support — no change to existing files
  - **MAJOR:** Any change to existing word content — triggers full wallet migration for all users with affected language wallets. This must never happen post-mainnet except in extreme circumstances (cryptographic vulnerability discovered in word set)
  - Every release requires: 2 cryptographer sign-offs + 2 native-language reviewer sign-offs per changed language
  *Effort: 3h*

- [ ] **10.3** 🔴 `[DEV]` Tag the first stable release in `bucks-wordlist` repo as `v1.0.0` once:
  - All Tier 1 wordlist files pass validation (#3.1.3)
  - `bip8192-manifest.json` is built (#4.3)
  - Cross-platform determinism test passes (#9.4)
  - Cryptographic audit complete (#8.5)
  - Regression test hashes recorded (#9.6)
  *Effort: 2h*
  *blocked by: all of the above*

- [ ] **10.4** 🟠 `[PM]` Write `docs/migration/wordlist-change-playbook.md` — instructions for future word list changes (in the event one is ever required):
  - Step 1: Identify the word(s) to change and document why
  - Step 2: Run full Levenshtein + phonetic + human review pipeline for replacement word
  - Step 3: Compute delta: which wallet phrases are affected (any phrase containing the removed word)
  - Step 4: Design in-app migration UX: detect affected wallets on launch, prompt user to migrate
  - Step 5: Version bump to `v2.0.0`, distribute updated wordlist via signed update package
  - Step 6: Maintain `v1.0.0` wordlist in app for a minimum of 12 months for users who have not yet migrated
  *Effort: 8h*

- [ ] **10.5** 🟠 `[PM]` Maintain `corpus/CHANGELOG.md` documenting:
  - Every word substitution (pre-freeze) with reason
  - Every language file addition with date and reviewer sign-off
  - Every version tag with what changed and why
  *Effort: ongoing*

- [ ] **10.6** 🟡 `[PM]` `[CRYPTO]` Legal review:
  - Confirm that the 2,048-word Arabic word list derived from the ancient corpus can be released under MIT or Apache 2.0 license
  - If the corpus itself has copyright considerations, confirm that a derived word list (not the corpus text itself) is clear of those restrictions
  - Obtain written legal opinion and store in `docs/legal/wordlist-license-opinion.md`
  - If MIT/Apache is not possible, determine an alternative licensing approach for the Soul Engine wordlist
  *Effort: 4h (coordination) + external legal review*

- [ ] **10.7** 🟡 `[PM]` Publish a public-facing description of the BIP-8192 soul wordlist (without revealing the actual words):
  - Blog post / whitepaper section: "BIP-8192 Soul Wordlist — Design Principles"
  - Describe: 2,048-word count, 11-bit encoding, multi-language support, collision resistance methodology, Soul of the World corpus provenance
  - Do NOT publish the word list itself or any portion of it
  - Submit BIP-8192 as a draft to the Bitcoin Improvement Proposals repository (or equivalent for Chain 8192) to establish the standard publicly
  *Effort: 6h*

---

## Dependency Graph Summary

```
1.1 → 1.3 → 1.4 → 1.5 → 1.7 → 1.9 → 1.10
                     ↓
1.6 ─────────────────┘
1.8 ────────────────────────────────────────→ 1.9

1.10 → 2.1 → 2.2 → 2.3 ─────┐
              ↓               ↓
             2.4 ─────────→ 2.5 → 2.6 → 2.7 → 2.8
                                          ↓
                            3.1.1 ─────────┘
                            3.1.2 → 3.2.x → 3.3.x → 3.4.x → 3.5.1 → 3.5.2
                                                               ↓
                            4.1 ─────────────────────────────→ 4.2 → 4.3 → 4.4
                                                                       ↓
                         5.1 ─── 5.2 → 5.4 → 5.5 → 5.6 → 9.2 → 9.3 → 9.4
                                  ↓
                         5.3 ← 4.3
                         8.3 ← 4.4

Critical path: 1.4 → 1.5 → 1.7 → 1.9 → 2.1 → 2.5 → 2.7 → Tier 1 translations → 4.3 → 5.3 → integration → testing → v1.0.0
```

---

*Document version: 1.0.0-draft*
*Classification: INTERNAL / PROPRIETARY — Chain 8192 Core Team only*
*Last updated: 2026-07-19*
