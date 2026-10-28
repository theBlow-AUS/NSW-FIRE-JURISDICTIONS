import { Router, type IRouter } from 'express';
// Shared with the independently packaged standalone HTTP service.
// @ts-ignore JavaScript module has runtime validation at the boundary.
import { createMapFeedService } from '../lib/map-feeds.mjs';

const router: IRouter = Router();
const feeds = createMapFeedService();
router.get('/map-feeds', async (req, res) => {
  try {
    const data = await feeds.load(req.query.url, req.query.refresh === '1');
    res.setHeader('Cache-Control', 'no-store');
    res.json(data);
  } catch (error: any) {
    req.log.warn({ message: error.message }, 'Map feed unavailable');
    res.status(error.status || 502).json({ error: error.message || 'Feed unavailable.' });
  }
});
export default router;
