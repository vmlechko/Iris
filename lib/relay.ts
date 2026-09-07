/** Client side of the relayer. Everything Iris puts on chain goes through here. */
export async function relay(body: Record<string, unknown>): Promise<{ hash: string }> {
  const response = await fetch("/api/relay", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Something went wrong.");
  return data;
}
