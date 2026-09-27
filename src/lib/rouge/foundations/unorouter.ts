import type { CapacityPriority } from "../../models/capacity";
import type { ModelProvider } from "../../models/provider";
import {
  UnoRouterProvider,
  type UnoRouterOptions,
} from "../../models/unorouter";
import type {
  CoreSpec,
  FoundationAdapter,
  FoundationCall,
  FoundationEvent,
} from "../foundation";

// The UnoRouter foundation (M56): the only place Rouge meets a provider.
//
// Every call is pinned to the core. Key handling, rate limits, the capacity
// scheduler and honest refusals are UnoRouterProvider's, unchanged: Rouge
// adds no key rotation and no way around a quota. When the call allows a
// substitute and the core refuses permanently (no credit, unknown model),
// the provider's verified free pool answers -- and servedModel() says so.

type ProviderFactory = (options: UnoRouterOptions) => ModelProvider;

export class UnoRouterFoundation implements FoundationAdapter {
  private readonly served = new Map<string, string>();

  constructor(
    readonly core: CoreSpec,
    private readonly options: {
      /** P0 for a person waiting on an answer; evaluations run lower. */
      priority?: CapacityPriority;
      /** Tests: build the provider. */
      provider?: ProviderFactory;
    } = {},
  ) {}

  servedModel(requestId: string) {
    return this.served.get(requestId);
  }

  async *stream(call: FoundationCall): AsyncIterable<FoundationEvent> {
    const factory =
      this.options.provider ??
      ((options: UnoRouterOptions) => new UnoRouterProvider(options));
    const provider = factory({
      model: this.core.id,
      reasoningEffort: this.core.reasoningLevels.length
        ? call.reasoning
        : undefined,
      fallback: call.allowSubstitute,
      priority: this.options.priority ?? "P0",
    });
    try {
      for await (const event of provider.stream({
        requestId: call.requestId,
        role: "STRONG",
        messages: [{ role: "system", content: call.system }, ...call.messages],
        signal: call.signal,
      })) {
        if (event.type === "delta") {
          yield event;
        } else {
          yield {
            type: "usage",
            usage: {
              inputTokens: event.usage.inputTokens ?? 0,
              outputTokens: event.usage.outputTokens ?? 0,
              cost: event.usage.cost ?? null,
            },
          };
        }
      }
    } finally {
      const served = provider.servedModel?.(call.requestId);
      if (served) this.served.set(call.requestId, served);
      // Bounded: only the most recent calls are remembered.
      if (this.served.size > 256) {
        const oldest = this.served.keys().next().value;
        if (oldest !== undefined) this.served.delete(oldest);
      }
    }
  }
}
