import { ethers } from "ethers";
import {
  assertBuilderAttributed,
  appendBuilderSuffix,
} from "../lib/builderAttribution";

export async function sendTransactionWithBuilderCode(
  signer: ethers.Signer,
  tx: ethers.TransactionRequest,
) {
  const data = appendBuilderSuffix((tx.data as `0x${string}` | undefined) ?? "0x");
  assertBuilderAttributed(data);
  console.log("FINAL_TX_DATA", data);
  return signer.sendTransaction({ ...tx, data });
}

export async function deployContractWithBuilderCode(
  factory: ethers.ContractFactory,
  args: readonly unknown[] = [],
) {
  const signer = factory.runner as ethers.Signer | null;
  if (!signer) throw new Error("Contract factory has no signer");

  const tx = await factory.getDeployTransaction(...args);
  const sent = await sendTransactionWithBuilderCode(signer, tx);
  const receipt = await sent.wait();
  if (!receipt?.contractAddress) {
    throw new Error("Deployment receipt did not include a contract address");
  }
  return factory.attach(receipt.contractAddress);
}
