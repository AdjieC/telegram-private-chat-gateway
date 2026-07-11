export function telegramResponse(payload, status = payload.ok === false ? payload.error_code : 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
