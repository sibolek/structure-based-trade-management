// Browser observations preserve the server-issued operation; they grant no authority.
export function mergePreviewObservation(prior, incoming) {
  const operationId = prior?.preview?.operationId;
  if (!operationId || incoming?.preview?.operationId !== operationId) return incoming;
  if (prior.receipt && !incoming.receipt) return prior;
  if (incoming.receipt || ["DISCARDED", "RETIRED"].includes(incoming.operation?.state)) return incoming;
  return prior.outcomeUnknown ? { ...incoming, outcomeUnknown: true } : incoming;
}

export async function acceptPreviewAndObserve(client, preview, publish) {
  let observation = { preview, operation: { operationId: preview.operationId, state: "ACCEPTING" }, outcomeUnknown: true };
  publish(observation);
  try {
    const response = await client.acceptPreview(preview);
    if (["ADMITTED", "ALREADY_PRESENT", "NOT_ADMITTED"].includes(response?.result)) {
      observation = { preview, operation: { operationId: preview.operationId, state: response.result }, receipt: response, outcomeUnknown: false };
    } else {
      observation = mergePreviewObservation(observation, response);
    }
    publish(observation);
    const status = await client.previewStatus(preview.previewId);
    observation = mergePreviewObservation(observation, status);
    publish(observation);
    return observation;
  } catch (error) {
    // POST transport errors, malformed responses and failed follow-up GETs cannot
    // establish non-admission. A known durable receipt survives a failed GET.
    publish(observation);
    throw error;
  }
}
