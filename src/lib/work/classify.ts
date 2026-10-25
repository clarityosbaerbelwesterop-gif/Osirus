import type { DifficultyClass } from "@/config/recommendations";

/**
 * Regelbasierte Klasse aus der Produktspezifikation §3.1.
 * Ein Treffer einer höheren Klasse gewinnt. Kein Modellaufruf.
 */

export type Classification = {
  difficulty: DifficultyClass;
  reason: string;
};

function words(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function classifyWorkPrompt(prompt: string): Classification {
  const text = prompt.trim();
  const count = words(text);

  if (
    count > 700 ||
    /maximal(?:er|en)? aufwand|maximum effort|ultra effort/i.test(text) ||
    /manufaktur/i.test(text) ||
    /neues produkt|new product/i.test(text) ||
    /ganze[nrs]?\s+(codebasis|codebase|repository|repo)|whole\s+(repo|repository|codebase)/i.test(
      text,
    ) ||
    /\b(refactor|migrat)/i.test(text)
  ) {
    return {
      difficulty: "XL",
      reason:
        "Die Aufgabe ist eine große Änderung über die Codebasis oder ausdrücklich maximaler Aufwand.",
    };
  }

  if (
    count > 200 ||
    /mehrere[n]?\s+module|across modules|multiple modules/i.test(text) ||
    /tests?\s+(müssen|must)|run the tests|npm test|build\s+(muss|must)|typecheck/i.test(
      text,
    ) ||
    /mit quellen|with sources|research with sources/i.test(text)
  ) {
    return {
      difficulty: "L",
      reason:
        "Die Aufgabe umfasst mehrere Module, eine längere Spezifikation oder Prüfungen, die laufen müssen.",
    };
  }

  if (
    count >= 50 ||
    /stack ?trace|traceback/i.test(text) ||
    /\b(bug|bugfix)\b/i.test(text) ||
    /\b[\w./-]+\.(ts|tsx|js|jsx|py|go|rs|sql|md)\b/i.test(text) ||
    /mehrere schritte|multiple steps|\bstep \d/i.test(text) ||
    /\b(research|recherche)\b/i.test(text)
  ) {
    return {
      difficulty: "M",
      reason:
        "Die Aufgabe hat mehrere Schritte, betrifft Dateien oder ist eine kurze Fehlersuche.",
    };
  }

  return {
    difficulty: "S",
    reason:
      "Die Aufgabe ist kurz, eine einzelne Frage, ohne Schreibzugriff auf ein Repository.",
  };
}
