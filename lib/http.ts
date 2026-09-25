import { logger } from "./log";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Wraps a route handler so thrown HttpErrors become JSON error responses. */
export function handler<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    const request = args[0] instanceof Request ? args[0] : undefined;
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof HttpError) return Response.json({ error: err.message }, { status: err.status });
      logger("api").error(`Unexpected error in ${request?.method ?? ""} ${request?.url ? new URL(request.url).pathname : ""}:`, err);
      return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
    }
  };
}
