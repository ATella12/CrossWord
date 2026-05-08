import { encodeFunctionData, toHex } from "viem";

export const BUILDER_CODE = "bc_vzag91ga";
export const BUILDER_MAGIC = "80218021802180218021802180218021";
export const BUILDER_DATA_SUFFIX = encodeBuilderDataSuffix(BUILDER_CODE);

type Hex = `0x${string}`;
type Eip1193Provider = {
  request?: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

function stringifyForLog(value: unknown): string {
  return JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v));
}

export function encodeBuilderDataSuffix(code: string): Hex {
  const bytes = new TextEncoder().encode(code.trim());
  const hex = Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const length = bytes.length.toString(16).padStart(2, "0");
  return `0x${hex}${length}00${BUILDER_MAGIC}` as Hex;
}

export function hasBuilderDataSuffix(data?: string | null): boolean {
  return Boolean(
    data &&
      data.toLowerCase().endsWith(BUILDER_DATA_SUFFIX.slice(2).toLowerCase()),
  );
}

export function appendBuilderSuffix(data?: `0x${string}` | null): `0x${string}` {
  const normalized = data ?? "0x";
  if (normalized.endsWith(BUILDER_DATA_SUFFIX.slice(2))) {
    return normalized;
  }
  const stripped = normalized.startsWith("0x") ? normalized.slice(2) : normalized;
  return `0x${stripped}${BUILDER_DATA_SUFFIX.slice(2)}` as `0x${string}`;
}

export function appendBuilderDataSuffix(data?: string | null): Hex {
  return appendBuilderSuffix((data as `0x${string}` | null) ?? null);
}

function mutateRequestPayload(args: { method: string; params?: unknown[] }) {
  if (args.method === "eth_sendTransaction") {
    const tx = ((args.params?.[0] as Record<string, unknown> | undefined) ?? {}) as Record<
      string,
      unknown
    >;
    const data = appendBuilderSuffix((tx.data as `0x${string}` | undefined) ?? "0x");
    assertBuilderAttributed(data);
    console.log("FINAL_TX_DATA", data);
    return {
      ...args,
      params: [{ ...tx, data }],
    };
  }

  if (args.method === "wallet_sendCalls") {
    const payload = ((args.params?.[0] as Record<string, unknown> | undefined) ?? {}) as Record<
      string,
      unknown
    >;
    const calls = (payload.calls as Array<Record<string, unknown>> | undefined) ?? [];
    const nextCalls = calls.map((call) => {
      const data = appendBuilderSuffix((call.data as `0x${string}` | undefined) ?? "0x");
      assertBuilderAttributed(data);
      return { ...call, data };
    });
    console.log("FINAL_TX_DATA", stringifyForLog({ ...payload, calls: nextCalls }));
    return {
      ...args,
      params: [{ ...payload, calls: nextCalls }],
    };
  }

  return args;
}

export function withBuilderCodeProvider<T extends Eip1193Provider>(provider: T): T {
  if (!provider?.request) return provider;
  const current = provider as T & { __builderCodePatched?: boolean };
  if (current.__builderCodePatched) return provider;
  const original = provider.request.bind(provider);
  current.request = async (args) => original(mutateRequestPayload(args));
  current.__builderCodePatched = true;
  return provider;
}

export function assertBuilderAttributed(data?: string | null): asserts data is Hex {
  if (!hasBuilderDataSuffix(data)) {
    throw new Error(
      "Blocked unattributed transaction: missing Base Builder Code suffix",
    );
  }
}

export async function supportsBuilderDataSuffix(
  provider?: Eip1193Provider,
  connector?: unknown,
): Promise<boolean> {
  try {
    const connectorCapabilities = JSON.stringify(connector ?? {}).toLowerCase();
    if (
      connectorCapabilities.includes("datasuffix") ||
      connectorCapabilities.includes("data_suffix")
    ) {
      return true;
    }

    if (!provider?.request) return false;
    const capabilities = await provider.request({
      method: "wallet_getCapabilities",
      params: [],
    });
    const serialized = JSON.stringify(capabilities).toLowerCase();
    return serialized.includes("datasuffix") || serialized.includes("data_suffix");
  } catch {
    return false;
  }
}

export async function sendTransactionWithBuilderCode(
  provider: Eip1193Provider,
  tx: Record<string, unknown>,
): Promise<Hex> {
  if (!provider?.request) throw new Error("No wallet provider available");

  const scopedProvider = withBuilderCodeProvider(provider);
  await supportsBuilderDataSuffix(scopedProvider);
  const data = appendBuilderSuffix((tx.data as `0x${string}` | undefined) ?? "0x");
  assertBuilderAttributed(data);
  console.log("FINAL_TX_DATA", data);

  const request = scopedProvider.request!.bind(scopedProvider);
  return (await request({
    method: "eth_sendTransaction",
    params: [{ ...tx, data }],
  })) as Hex;
}

export async function writeContractWithBuilderCode(
  provider: Eip1193Provider,
  params: {
    from?: Hex;
    address: Hex;
    abi: unknown;
    functionName: string;
    args?: readonly unknown[];
    value?: bigint;
    chainId?: number;
  },
): Promise<Hex> {
  const data = (encodeFunctionData as (args: {
    abi: unknown;
    functionName: string;
    args: readonly unknown[];
  }) => Hex)({
    abi: params.abi,
    functionName: params.functionName,
    args: params.args ?? [],
  });

  return sendTransactionWithBuilderCode(provider, {
    from: params.from,
    to: params.address,
    data,
    ...(params.value !== undefined ? { value: toHex(params.value) } : {}),
    ...(params.chainId !== undefined ? { chainId: toHex(params.chainId) } : {}),
  });
}

export async function sendCallsWithBuilderCode(options: {
  sendCallsAsync?: (args: unknown) => Promise<unknown>;
  provider?: Eip1193Provider;
  from?: Hex;
  chainId: number;
  calls: Array<{ to: Hex; data?: Hex; value?: bigint }>;
}): Promise<unknown> {
  await supportsBuilderDataSuffix(options.provider);
  const scopedProvider = options.provider ? withBuilderCodeProvider(options.provider) : options.provider;
  const calls = options.calls.map((call) => ({
    ...call,
    data: appendBuilderSuffix(call.data || "0x"),
  }));
  calls.forEach((call) => assertBuilderAttributed(call.data));

  if (options.sendCallsAsync) {
    try {
      return await options.sendCallsAsync({
        calls,
        chainId: options.chainId,
        capabilities: { dataSuffix: BUILDER_DATA_SUFFIX },
      });
    } catch {
      // Fall through to provider methods with manually suffixed calldata.
    }
  }

  if (!scopedProvider?.request) throw new Error("No wallet provider available");

  try {
    const payload = {
      chainId: toHex(options.chainId),
      from: options.from,
      calls: calls.map((call) => ({
        to: call.to,
        data: call.data,
        ...(call.value !== undefined ? { value: toHex(call.value) } : {}),
      })),
      capabilities: { dataSuffix: BUILDER_DATA_SUFFIX },
    };
    console.log("FINAL_TX_DATA", stringifyForLog(payload));
    return await scopedProvider.request({
      method: "wallet_sendCalls",
      params: [payload],
    });
  } catch (error) {
    const first = calls[0];
    if (!first || calls.length > 1) throw error;
    return sendTransactionWithBuilderCode(scopedProvider, {
      from: options.from,
      to: first.to,
      data: first.data,
      ...(first.value !== undefined ? { value: toHex(first.value) } : {}),
      chainId: toHex(options.chainId),
    });
  }
}
