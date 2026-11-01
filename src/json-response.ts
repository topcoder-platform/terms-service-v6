import type { Response } from 'express';
/** Encode HTML-sensitive characters at the JSON wire layer without changing parsed values. */
export function sendJson(res: Response, value: unknown) {
  const body = JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  res.type('application/json').send(body);
}
