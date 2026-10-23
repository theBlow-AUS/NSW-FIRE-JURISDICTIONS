import { Router } from 'express';
import { GetFireContextQueryParams, GetFireContextResponse, GetRfsSnapshotResponse, GetRfsStatusResponse } from '@workspace/api-zod';
import { buildFireContext, lookupSpatialContext } from '@workspace/fire-data';
import { readRfsSnapshot } from '../rfs/cache';

const router = Router();
router.get('/fire-context', async (req, res): Promise<void> => {
  const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
  if (![req.query.latitude, req.query.longitude].every((v) => typeof v === 'string' && decimal.test(v.trim()))) {
    res.status(400).json({ error: 'Valid decimal latitude and longitude are required.' });
    return;
  }
  const parsed = GetFireContextQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Valid decimal latitude and longitude are required.' });
    return;
  }
  const [spatial, { snapshot, status }] = await Promise.all([
    lookupSpatialContext(parsed.data.latitude, parsed.data.longitude), readRfsSnapshot(),
  ]);
  res.set('Cache-Control', 'no-store');
  res.json(GetFireContextResponse.parse(buildFireContext(spatial, snapshot, status)));
});
router.get('/rfs/status', async (_req, res): Promise<void> => {
  const { status } = await readRfsSnapshot();
  res.set('Cache-Control', 'no-store');
  res.json(GetRfsStatusResponse.parse(status));
});
router.get('/rfs/snapshot', async (_req, res): Promise<void> => {
  res.set('Cache-Control', 'no-store');
  res.json(GetRfsSnapshotResponse.parse(await readRfsSnapshot()));
});
export default router;
