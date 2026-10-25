"use client";

import { useMemo, useState } from "react";
import { EXECUTION_SUBAGENT_CAP } from "@/lib/work/limits";
import type { WorkRecommendation } from "@/lib/work/recommend";
import { ChainOfThought, ChainStep, type StepStatus } from "../assistant/chain";
import { ModelSelect, type ModelOption } from "../assistant/model-select";
import {
  PromptInput,
  PromptInputActions,
  PromptInputTextarea,
} from "../assistant/prompt-input";

type RunResult = {
  execution?: {
    status: string;
    message: string | null;
    subagents: {
      index: number;
      status: string;
      costUsd: number | null;
      error: string | null;
    }[];
    review: { verdict: string; findings: string | null; modelId: string };
  };
  error?: string;
  message?: string;
};

function stepStatus(status: string): StepStatus {
  if (status === "completed") return "completed";
  if (status === "failed") return "error";
  if (status === "running") return "active";
  if (status === "unavailable") return "unavailable";
  return "pending";
}

export function WorkStudio(props: {
  initialRecommendation?: WorkRecommendation | null;
  models?: readonly ModelOption[];
}) {
  const [prompt, setPrompt] = useState("");
  const [recommendation, setRecommendation] =
    useState<WorkRecommendation | null>(props.initialRecommendation ?? null);
  const [executorId, setExecutorId] = useState(
    props.initialRecommendation?.executor.modelId ?? "",
  );
  const [reviewerId, setReviewerId] = useState(
    props.initialRecommendation?.reviewer.modelId ?? "",
  );
  const [count, setCount] = useState(
    props.initialRecommendation?.subAgents.count ?? 0,
  );
  const [busy, setBusy] = useState<"recommend" | "run" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const models = useMemo(() => props.models ?? [], [props.models]);

  const executorChosen =
    recommendation !== null && executorId !== recommendation.executor.modelId;
  const reviewerChosen =
    recommendation !== null && reviewerId !== recommendation.reviewer.modelId;
  const countChosen =
    recommendation !== null && count !== recommendation.subAgents.count;

  const options = useMemo(() => {
    if (!recommendation) return models;
    const extras = models.filter(
      (model) =>
        model.id !== recommendation.executor.modelId &&
        model.id !== recommendation.reviewer.modelId,
    );
    return extras;
  }, [models, recommendation]);

  const recommend = async () => {
    setBusy("recommend");
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/work/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const body = (await response.json()) as WorkRecommendation & {
        message?: string;
      };
      if (!response.ok) {
        setError(body.message ?? "Die Empfehlung ist nicht verfügbar.");
        return;
      }
      setRecommendation(body);
      setExecutorId(body.executor.modelId);
      setReviewerId(body.reviewer.modelId);
      setCount(body.subAgents.count);
    } catch {
      setError("Die Empfehlung ist nicht verfügbar.");
    } finally {
      setBusy(null);
    }
  };

  const start = async () => {
    if (!recommendation) return;
    setBusy("run");
    setError(null);
    try {
      const response = await fetch("/api/work/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          executorModelId: executorId,
          reviewerModelId: reviewerId,
          subAgentCount: count,
        }),
      });
      const body = (await response.json()) as RunResult;
      if (!response.ok) {
        setError(body.message ?? "Der Lauf wurde nicht gestartet.");
        return;
      }
      setResult(body);
    } catch {
      setError("Der Lauf wurde nicht gestartet.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="recommend-grid">
      <PromptInput
        label="Work"
        onSubmit={() => {
          if (prompt.trim()) void recommend();
        }}
      >
        <PromptInputTextarea
          aria-label="Aufgabe"
          value={prompt}
          placeholder="Aufgabe beschreiben"
          onChange={(event) => setPrompt(event.target.value)}
        />
        <PromptInputActions>
          <button
            type="submit"
            className="btn"
            disabled={busy !== null || !prompt.trim()}
          >
            {busy === "recommend" ? (
              <span className="text-shimmer">Empfehlung</span>
            ) : (
              "Empfehlung"
            )}
          </button>
        </PromptInputActions>
      </PromptInput>
      {error ? (
        <p role="alert" className="subtle">
          {error}
        </p>
      ) : null}
      {recommendation ? (
        <section className="card" aria-label="Empfehlung">
          <p>
            Klasse <strong>{recommendation.difficulty}</strong>
          </p>
          <p>{recommendation.reason}</p>
          <div className="recommend-grid">
            <ModelSelect
              label="Ausführendes Modell"
              value={executorId}
              options={
                options.length
                  ? options
                  : recommendation.executor.placeholder
                    ? []
                    : [
                        {
                          id: recommendation.executor.modelId,
                          label: recommendation.executor.label,
                        },
                      ]
              }
              recommended={!executorChosen}
              chosen={executorChosen}
              onChange={setExecutorId}
            />
            {recommendation.executor.placeholder ? (
              <p className="subtle">
                Empfohlen: Platzhalter {recommendation.executor.modelId}. Bald
                verfügbar, bis AI Trainer und Kai eine Katalog-ID eintragen.
              </p>
            ) : null}
            <ModelSelect
              label="Prüfermodell"
              value={reviewerId}
              options={options.filter((option) => option.id !== executorId)}
              recommended={!reviewerChosen}
              chosen={reviewerChosen}
              onChange={setReviewerId}
            />
            {recommendation.reviewer.placeholder ? (
              <p className="subtle">
                Empfohlen: Platzhalter {recommendation.reviewer.modelId}. Das
                Prüfermodell ist ein anderes Modell als der Ausführer.
              </p>
            ) : null}
            <label>
              <span className="model-select-label">
                Subagents
                {countChosen ? (
                  <span className="badge">eigene Wahl</span>
                ) : (
                  <span className="badge badge-accent">Empfohlen</span>
                )}
              </span>
              <input
                aria-label="Anzahl Subagents"
                type="number"
                min={recommendation.subAgents.min}
                max={recommendation.subAgents.max}
                value={count}
                onChange={(event) => {
                  const parsed = Number(event.target.value);
                  if (!Number.isFinite(parsed)) {
                    setCount(recommendation.subAgents.count);
                    return;
                  }
                  setCount(
                    Math.max(
                      recommendation.subAgents.min,
                      Math.min(
                        recommendation.subAgents.max,
                        Math.floor(parsed),
                      ),
                    ),
                  );
                }}
              />
            </label>
            <p className="subtle">
              {recommendation.cost.status === "estimated"
                ? `Kostenschätzung ${recommendation.cost.usd} USD. ${recommendation.cost.note}`
                : recommendation.cost.reason}
              {count > EXECUTION_SUBAGENT_CAP
                ? ` Mehr als ${EXECUTION_SUBAGENT_CAP} Subagents starten ist bald verfügbar.`
                : ""}
            </p>
            <button
              type="button"
              className="btn"
              disabled={busy !== null || reviewerId === executorId}
              onClick={() => void start()}
            >
              {busy === "run" ? (
                <span className="text-shimmer">Start</span>
              ) : (
                "Start"
              )}
            </button>
          </div>
        </section>
      ) : null}
      {result?.execution ? (
        <section aria-label="Lauf">
          <p
            className={
              result.execution.status === "unavailable" ? "" : "stream-line"
            }
          >
            {result.execution.message ?? result.execution.status}
          </p>
          <ChainOfThought label="Subagents">
            {result.execution.subagents.map((sub) => (
              <ChainStep
                key={sub.index}
                status={stepStatus(sub.status)}
                title={`Subagent ${sub.index + 1}`}
                detail={
                  sub.costUsd !== null
                    ? `${sub.status}, ${sub.costUsd} USD`
                    : (sub.error ?? sub.status)
                }
              />
            ))}
            <ChainStep
              status={
                result.execution.review.verdict === "unavailable"
                  ? "unavailable"
                  : "completed"
              }
              title={`Prüfer: ${result.execution.review.verdict}`}
              detail={result.execution.review.findings}
            />
          </ChainOfThought>
        </section>
      ) : null}
    </div>
  );
}
