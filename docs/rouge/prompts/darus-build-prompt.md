# Prompt: Darus v0 bis Freitag, 9. Oktober 2026 (Pre-Training, Fine-Tuning, Build)

Kopierfertig für einen Coding-Agenten (Claude Code) im Repo `clarityosbaerbelwesterop-gif/Osirus`, Branch `rouge/native-model-m58`.
Alle Zahlen stammen aus dem Repo, Stand 5. Oktober 2026. Der Agent prüft sie vor Gebrauch erneut.

---

## Rolle

Du baust **Darus**, das Flaggschiff-Generalistenmodell des Rouge-Programms.
- Rouge 1 ist das lokale Produktmodell.
- Quesnir ist der Code- und Security-Spezialist.
- Darus soll das stärkste der drei Modelle werden.

Du arbeitest wie ein Frontier-Lab:
- Jede Behauptung beruht auf einer Messung.
- Jede Messung ist vorher registriert.
- Jeder bezahlte Lauf hat eine Obergrenze und eine Freigabe.

## Ausgangslage (Fakten aus dem Repo)

| Punkt | Stand |
|---|---|
| Basis-Kandidat | `deepseek-ai/DeepSeek-V4-Flash` @ `60d8d70`: 291 B Parameter, MoE (43 Layer, 256 Experten, top-6), FP4-Experten, FP8 Rest, 159,6 GB in 46 Shards, MIT-Lizenz (`docs/rouge/rouge1-base-plan.md`). Noch nicht gepinnt. |
| Teacher | `DeepSeek-V4-Pro` @ `b5968e9`: 1,6 T Parameter, 864,7 GB, MIT, selbst gehostet, nie über die API (`models/teachers/deepseek-v4-pro.json`, `lightning_ai/teacher_job.sh`). |
| Maschine | Lightning `B200_X_8`: 1,44 TB GPU-Speicher, 78,87 USD/h. Die Basis passt für Inferenz und Adapter-Training. Volles Training bräuchte etwa 4,7 TB, also Multi-Node und ein eigenes Budget. |
| Programm | `training/rouge/program/lines.json`: Darus hat Priorität 3. Der nächste Job ist `darus-phase0-001` (B200_X_8, 1,5 h). Er ist blockiert durch Basis-Pin, Daten, Pre-Registrierung und Budget. |
| Budget | Obergrenze 128,66 USD, davon 3,66 USD verbraucht, also 125,00 USD frei. `darus-phase0-001` kostet im schlimmsten Fall 124,22 USD. `rouge-1-rl-001` kostet im schlimmsten Fall 94,50 USD (Werte aus `program/plan.py`). **Beide zusammen passen nicht unter die Obergrenze.** |
| Werkzeuge vorhanden | `rouge_train` (ReST-EM, exakter McNemar-Gate, `ttc.py`), `lightning_ai/` (Launcher, `cost.py`, Ledger, Storage), `program/plan.py` und `program/launch.py` (parallele Jobs unter der Obergrenze), `.github/workflows/rouge-train.yml`. |
| Offene Owner-Aktionen | neuer `LIGHTNING_AI_API_KEY` (der alte wird abgelehnt), Guthaben, Owner als Reviewer der Environment `rouge-gpu`. |

## Was "Pre-Training" für Darus bis Freitag ehrlich heißt

- **Pre-Training von Grund auf ist bis Freitag unmöglich.**
  - Zum Vergleich: DeepSeek-V3 (671 B Parameter, 14,8 T Tokens) brauchte laut eigenem Technical Report (arXiv 2412.19437) 2,788 Mio. H800-GPU-Stunden.
  - Das sind Millionen USD. Frei sind 125 USD.
  - Darus startet deshalb von einer offenen Basis, wie jedes Lab, das nicht selbst vortrainiert.
- **Machbar ist Continued Pre-Training (CPT) mit Adaptern.**
  - Der Korpus ist kurz, kuratiert und lizenzgeprüft, mit Schwerpunkt Deutsch, Code und Mathe.
  - Der Agent nutzt die Textquellen von `training/rouge/native/data/` (FineWeb-Edu, FineWeb-2 Deutsch, Wikipedia de/en, OpenWebMath, permissiver Code). Er tokenisiert sie neu mit dem V4-Tokenizer, weil der Rouge-Tokenizer nicht passt.
  - CPT ist optional. Es läuft nur, wenn es ins Budget passt und sein eigenes Gate besteht: niedrigere BPB auf deutschem Held-out-Text, keine Kategorie verschlechtert sich.
- **Echtes Pre-Training von Grund auf** bleibt die native Leiter (100M, dann 300M, dann 1B) in `training/rouge/native`. Sie ist ein eigenes Programm und nicht Teil von Freitag.

## Wie stark Darus sein soll

### Ziel für Freitag (Darus v0), alles gemessen

1. **Primär-Gate (pre-registriert, entscheidet allein):**
   - Darus v0 schlägt die gepinnte V4-Flash-Basis auf der Held-out-Suite. Test: exakter McNemar, p < 0,05.
   - Keine Kategorie verschlechtert sich signifikant.
   - Suite: dieselbe wie `experiments/rouge-1-rl-001.json`, damit Darus direkt mit Rouge 1 vergleichbar ist. Ihr Hash ist gepinnt.
   - Bei FAIL wird nichts promotet. Der Bericht sagt warum.
2. **Gegen Rouge 1 (deskriptiv):** dieselbe Suite, dieselbe Auswertung. Ziel: Darus v0 ist pro Kategorie mindestens gleich gut wie die beste Rouge-1-Iteration.
3. **Test-Time Compute (deskriptiv):** `ttc-report` mit k = 8 (pass@1, maj@k). Die Oracle-Schranke wird ausdrücklich als "kein Ergebnis" ausgewiesen.
4. **Öffentliche Benchmarks:** nur gemessen berichtet, mit Harness, Version und Kontaminationsprüfung. Frontier-Zahlen aus `docs/rouge/frontier-reference-2026.md` (zum Beispiel Opus 5.5, Terminal-Bench 4.0: 66,4) sind Referenz, kein Freitagsziel.
5. **Lokal:** Darus läuft quantisiert auf einem Mac Studio mit mindestens 192 GB. Gemessen werden Tokens/s und Speicher. Falls llama.cpp/GGUF die V4-Architektur nicht unterstützt, wird das belegt und der Fallback genannt (Adapter plus vLLM auf eigener Hardware).

### Langfristiges Ziel ("Endboss")

- Darus wird in jeder Kategorie der internen Suites das beste Modell des Programms.
- "100 % in allem" heißt: 100 % auf den eigenen, verifizierbaren Gates. Jede Aufgabe ist per Code-Check, Unit-Test oder exakter Antwort nachweisbar gelöst.
- 100 % auf öffentlichen Benchmarks ist kein gültiges Ziel, weil deren fehlerhafte Items die Obergrenze unter 100 % drücken. Das ist dieselbe Regel wie bei Quesnir.
- Volles Training von Darus (etwa 4,7 TB Optimizer-State) braucht ein eigenes Multi-Node-Budget. Es wird erst nach einem bestandenen v0-Gate geplant.

## Fine-Tuning-Rezept (Darus v0)

| Schritt | Inhalt | Kosten |
|---|---|---|
| 0. Pin | Manifest-Lauf auf einem freien GitHub-Runner (Hub-LFS-Metadaten): sha256 je Shard, LICENSE = MIT-Text, `config.json`. Ergebnis: `models/darus/base.json`. Erst danach ist V4-Flash die Basis. | 0 |
| 1. Daten `darus-v0` | Verifizierbare Prompts aus Mathe (numerisch), Code (Unit-Tests), Reasoning und Deutsch, lizenzgeprüft und dedupliziert. Dekontaminiert gegen jede Eval-Suite (13-Gram plus exakter Prompt). Manifest committen, Gewichte und Daten nur in der privaten Lightning-Registry. | 0 |
| 2. Pre-Registrierung | `experiments/darus-phase0-001.json`: Hypothese, Suite-Hash, Seeds, Gate (siehe oben), Abbruchkriterien, Budget. Committen **vor** jedem bezahlten Lauf. | 0 |
| 3. CPU-Smoke | Winziges MoE (zufällige Gewichte, gleiche Architekturklasse): LoRA-Pfad, Speichern und Laden, Merge, Eval-Pfad. Test in CI. | 0 |
| 4. Bezahlte Session `darus-phase0-001` auf B200_X_8 | BASE (Download, Hash-Check) → EVAL_BASE → SAMPLE (Rejection Sampling, nur verifizierte Antworten) → SFT der Adapter → EVAL → Gate → Upload des Adapters in die private Registry. Bei FAIL wird nichts promotet. | höchstens 1,5 h, schlimmster Fall 124,22 USD |
| 5. Teacher (optional) | V4-Pro löst nur die Prompts, an denen Darus scheitert (`hard.jsonl`). Nur geprüfte Lösungen werden genutzt (`teacher_job.sh`). Eine eigene Session, nur mit eigenem Budget. | etwa 87 USD, höchstens 124 USD |
| 6. Paket | Adapter mergen, quantisieren, lokal messen (Punkt 5 oben). | 0, auf Owner-Hardware |

- **Adapter-Ziel:** LoRA auf Attention und Shared Experts. Die Routed Experts bleiben eingefroren (FP4).
- Lässt das Framework kein Training gegen die FP4-Experten zu, gilt der Fallback: Adapter nur auf den Nicht-Experten-Layern. Das wird im Smoke (Schritt 3) und im GPU-Dry-Run belegt, nicht angenommen.

## Zeitplan

| Tag | Arbeit |
|---|---|
| Mo 5.10. | Pin-Lauf, Daten-Rezept `darus-v0`, Pre-Registrierung, CPU-Smoke. Owner-Aktionen anfragen. |
| Di 6.10. | Daten bauen und verifizieren, CI grün, Dry-Run-Kommando (`program/launch.py --dry-run`). |
| Mi 7.10. | Owner-Freigabe in `rouge-gpu`, dann bezahlte Session `darus-phase0-001`. |
| Do 8.10. | Gate-Bericht. Bei PASS: Teacher-Runde oder CPT, nur mit freiem Budget und Freigabe. |
| Fr 9.10. | Paket und lokale Messung, Abschlussbericht. |

**Kritischer Pfad:**
- Ohne neuen Lightning-Key und Guthaben bis Mittwoch gibt es keinen Darus am Freitag. Alles Kostenlose ist dann trotzdem fertig.
- Wegen der Obergrenze entscheidet der Owner: **Darus vor Rouge 1, oder Obergrenze um mindestens 94 USD erhöhen**, damit beide laufen. Der Planner lässt sonst nur `rouge-1-rl-001` zu (Priorität 1).

## Harte Regeln

- **Repo und Daten:**
  - Das Repo ist öffentlich: keine Secrets in Code, Logs oder Chat. Secrets nur per Name.
  - Keine Gewichte und keine Trainingsdaten in git. Nur Hashes und Manifeste.
- **Geld:**
  - Kein bezahlter Lauf ohne Freigabe in `rouge-gpu`.
  - Kein Lauf, dessen schlimmster Fall die Obergrenze übersteigt (`cost.check`).
  - Vor jeder Ausgabe den Owner fragen.
- **Herkunft und Lizenz:**
  - Keine Ausgaben geschlossener APIs als Trainingsdaten. Der Teacher läuft nur selbst gehostet.
  - Nur Lizenzen, die Training und Weitergabe erlauben. Jede Quelle steht im Manifest.
- **Ergebnisse:**
  - Ein Kandidat bewertet sich nie selbst. Der Evaluator ist ein getrennter Prozess. Die Held-out-Suite enthält keinen Trainings- oder Teacher-Prompt.
  - Keine Modell-IDs erfinden. Jede Revision ist gepinnt und gehasht.
- **Git:** kein Merge nach `main`, kein PR ohne Auftrag des Owners.
- **Bei Unklarheit:** Fakten prüfen statt annehmen. Was nicht geht, belegen und die beste machbare Alternative liefern.

## Lieferung

1. **Commits auf `rouge/native-model-m58`:**
   - `models/darus/base.json`
   - Daten-Manifest `darus-v0`
   - `experiments/darus-phase0-001.json`
   - Smoke-Test
   - aktualisierte `program/lines.json` (Darus `ready: true`, sobald nur noch die Freigabe fehlt)
   - nach dem Lauf: `results/darus-phase0-001/` mit README und VERDICT
2. **Bericht an den Owner auf Deutsch:**
   - Gate-Ergebnis mit Zahlen
   - Vergleich mit Basis und Rouge 1
   - Kosten laut Ledger
   - was lokal läuft
   - nächste Schritte mit Preis
