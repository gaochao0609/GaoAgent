const buildHeaders = (contentType: string | null) => {
  const headers = new Headers();
  headers.set("Content-Type", contentType ?? "application/x-ndjson; charset=utf-8");
  headers.set("Cache-Control", "no-cache");
  return headers;
};

export const proxyFormData = async (req: Request, backendUrl: string) => {
  const formData = await req.formData();
  const response = await fetch(backendUrl, {
    method: "POST",
    body: formData,
  });

  const headers = buildHeaders(response.headers.get("content-type"));
  if (!response.body) {
    const text = await response.text();
    return new Response(text, { status: response.status, headers });
  }

  return new Response(response.body, { status: response.status, headers });
};

export const proxyGet = async (backendUrl: string) => {
  const response = await fetch(backendUrl, { method: "GET" });
  const headers = buildHeaders(response.headers.get("content-type"));
  const text = await response.text();
  return new Response(text, { status: response.status, headers });
};
