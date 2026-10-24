/**
 * How many sub-agents one web request will actually call.
 * The recommendation table may suggest more. Above this cap the run is
 * refused before any model call: parallel fan-out is not built.
 * Subscription caps are Tung's branch and are not applied here.
 */
export const EXECUTION_SUBAGENT_CAP = 8;
