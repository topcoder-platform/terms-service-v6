import type { Request, Response } from 'express';
import { stringify } from 'node:querystring';
export function pagination(req: Request, res: Response, result: { total: number; page: number | undefined; perPage: number | undefined }) {
  const { total, page, perPage } = result;
  const pages = Math.ceil(total / Number(perPage));
  if (Number(page) > 1) res.set('X-Prev-Page', String(Number(page) - 1));
  if (Number(page) < pages) res.set('X-Next-Page', String(Number(page) + 1));
  res.set('X-Page', String(page)); res.set('X-Per-Page', String(perPage)); res.set('X-Total', String(total)); res.set('X-Total-Pages', String(pages));
  if (pages > 0) {
    const link = (p: number) => `${req.protocol}://${req.get('Host')}${req.baseUrl}${req.path}?${stringify({ ...req.query, page: p } as any)}`;
    let value = `<${link(1)}>; rel="first", <${link(pages)}>; rel="last"`;
    if (Number(page) > 1) value += `, <${link(Number(page) - 1)}>; rel="prev"`;
    if (Number(page) < pages) value += `, <${link(Number(page) + 1)}>; rel="next"`;
    res.set('Link', value);
  }
  const existing = res.get('Access-Control-Expose-Headers');
  res.set('Access-Control-Expose-Headers', `${existing ? existing + ', ' : ''}X-Page, X-Per-Page, X-Total, X-Total-Pages, X-Prev-Page, X-Next-Page`);
}
