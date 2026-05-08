"use client";

import { useAccount, useSendTransaction, useWriteContract } from "wagmi";
import { useSendCalls } from "wagmi/experimental";
import {
  sendCallsWithBuilderCode,
  sendTransactionWithBuilderCode,
  withBuilderCodeProvider,
  writeContractWithBuilderCode,
} from "./builderAttribution";

async function getProvider(connector: unknown): Promise<{
  request?: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}> {
  const maybeConnector = connector as
    | { getProvider?: () => Promise<unknown> | unknown }
    | undefined;
  return (maybeConnector?.getProvider
    ? maybeConnector.getProvider()
    : (globalThis as { ethereum?: unknown }).ethereum) as {
    request?: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  };
}

export function useBuilderWriteContract() {
  const { address, connector } = useAccount();
  const write = useWriteContract();

  return {
    ...write,
    writeContractAsync: async (params: {
      account?: `0x${string}`;
      address: `0x${string}`;
      abi: unknown;
      functionName: string;
      args?: readonly unknown[];
      value?: bigint;
      chainId?: number;
    }) =>
      writeContractWithBuilderCode(withBuilderCodeProvider(await getProvider(connector)), {
        from: params.account || address,
        ...params,
      }),
  };
}

export function useBuilderSendTransaction() {
  const { connector } = useAccount();
  const sendTx = useSendTransaction();

  return {
    ...sendTx,
    sendTransactionAsync: async (tx: Record<string, unknown>) =>
      sendTransactionWithBuilderCode(withBuilderCodeProvider(await getProvider(connector)), tx),
  };
}

export function useBuilderSendCalls() {
  const { address, connector } = useAccount();
  const sendCalls = useSendCalls();

  return {
    ...sendCalls,
    sendCallsAsync: async (params: {
      chainId: number;
      from?: `0x${string}`;
      calls: Array<{ to: `0x${string}`; data?: `0x${string}`; value?: bigint }>;
    }) =>
      sendCallsWithBuilderCode({
        ...params,
        from: params.from || address,
        sendCallsAsync: (sendCalls as { sendCallsAsync?: (args: unknown) => Promise<unknown> })
          .sendCallsAsync,
        provider: withBuilderCodeProvider(await getProvider(connector)),
      }),
  };
}
