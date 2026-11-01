import { All, Controller, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { legacyPaths } from './routes.js';
import { config } from './config.js';
@Controller()
export class FallbackController {
  @All('{*path}') fallback(@Req() req: Request, @Res() res: Response) {
    const url = req.path.startsWith(config.BASE_PATH) ? req.path.substring(config.BASE_PATH.length) : req.path;
    const found = legacyPaths.includes(url);
    res.status(found ? 405 : 404).json({ message: found ? 'The requested HTTP method is not supported.' : 'The requested resource cannot be found.' });
  }
}
