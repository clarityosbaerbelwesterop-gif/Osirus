# M30.2 capability baseline

Measured by `runCapabilityBaseline` in `src/lib/agent/baseline.ts` (see `tests/capability-baseline.test.ts`).

Live model providers were not called. Cost is null because the offline protocol has no provider usage. Latency below is wall clock for that protocol on one host, excluding the false-completion probe, and is not model latency.

False completion is a second loop that FINISHes an unsupported claim. Since M33, gated domains (hypotheses or success criteria on TaskKernel) block that FINISH in the production loop; ungated domains still accept it and the independent grader rejects it. Probe calls are not included in the counts.

Verified success means an independent check agreed with the protocol outcome: hypothesis status for the conflict, `computeEvidenceCheck` for math and the revised rate, both fixture URLs cited for research, the file the write tool actually stored for building, and `TaskState.knownFacts` for memory. It does not mean a live model was graded.

| Domain    | Success | Verified | False completion | Model calls | Tool calls | Steps | Repairs | Latency ms |
| --------- | ------- | -------- | ---------------- | ----------- | ---------- | ----- | ------- | ---------- |
| THINKING  | true    | true     | false            | 3           | 0          | 3     | 1       | 2          |
| REASONING | true    | true     | false            | 5           | 2          | 5     | 2       | 10         |
| CODING    | false   | false    | true             | 3           | 2          | 3     | 0       | 71         |
| RESEARCH  | true    | true     | false            | 5           | 2          | 5     | 0       | 1          |
| MATH      | true    | true     | false            | 3           | 1          | 3     | 0       | 1          |
| BUILDING  | true    | true     | true             | 2           | 1          | 2     | 0       | 0          |
| COMPUTER  | true    | false    | true             | 2           | 1          | 2     | 0       | 1          |
| MEMORY    | true    | true     | true             | 2           | 0          | 2     | 0       | 0          |

Computer success is the click, not the page. This host has `/usr/bin/google-chrome`. The protocol clicked Add item and saw "1 item". `reportFrom` still failed `buttons-have-names` and `no-overflow:phone`, so verified success is false. A machine with no Chromium binary records success false and says the workflow was not driven. The test allows that.

## THINKING

Ship the billing export this week. It must be complete for finance, but do not change the schema, and finance says the schema is wrong.

Offline protocol. No live THINKING model. The loop recorded the conflict as an open question and rejected the hypothesis that both constraints hold. A separate FINISH that claims both are satisfied is blocked by the M33 finish gate.

## REASONING

A pump fills a tank in 6 hours. A leak empties it in 12 hours. Starting empty, both run. How many hours to fill? Revise the estimate if it ignores the leak.

Offline protocol over production `compute.run` (mathjs) and `computeEvidenceCheck` (passed: the result matches a deterministic computation; no second method was available to confirm it). The pump-only hypothesis was rejected by its falsifier. The 12 hour hypothesis was supported and not rejected. A FINISH that states Result: 6 is blocked by the M33 finish gate.

## CODING

The test suite fails: `median()` returns the wrong value for arrays with an even number of elements. Fix the bug so all tests pass.

Offline protocol on a real median fixture (visible test plus hidden `node:test`). The loop read the file and ran the visible test. No live coding model was available, so no patch was invented. Hidden tests still fail. Success is false because the bug remains. A FINISH that claims the tests pass is accepted while they fail.

## RESEARCH

When was the North Span bridge opened? Two sources disagree. Report the disagreement; do not pick a year the sources do not share.

Offline fixture documents, not live web search. Each VERIFY named one hypothesis, so both can be supported without either being treated as the resolved fact. A FINISH that picks 1998 and drops the contradiction is blocked by the M33 finish gate.

## MATH

A price is 80. Apply a 15% discount, then a 10% tax on the discounted price. What is paid?

Offline protocol. `compute.run` used in-process mathjs. `computeEvidenceCheck` passed. Independently confirmed is false, because only mathjs is loaded. A FINISH of Result: 1 is blocked by the M33 finish gate.

## BUILDING

Build a one-page export screen with a button named Save and the text Export ready.

Offline fixture workspace. The production browser QA path needs a sandbox workspace, which this baseline does not open. Verified here means the file the tool wrote contains the required text and button. The answer does not claim browser QA. A FINISH that claims production QA passed is still accepted.

## COMPUTER

Open the cart page, click Add item, and check that the count becomes 1 item. Report accessibility and phone overflow rather than claiming the page is fine.

Live Chromium at `/usr/bin/google-chrome` clicked `#add`. `reportFrom` failed `buttons-have-names` and `no-overflow:phone`. The protocol reports those failures. A FINISH that claims browser QA passed is still accepted, and the grader rejects it.

## MEMORY

Continue Atlas. Which port does the preview use, and which schema constraint did we already accept?

Offline memory hook, not a live memory store. The fact is written into `TaskState.knownFacts` and is on the next slice's prompt. Retrieval is not a Memory OS. A FINISH that invents port 3000 is still accepted by the loop.
