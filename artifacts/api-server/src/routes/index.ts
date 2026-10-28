import { Router, type IRouter } from "express";
import healthRouter from "./health";
import fireRouter from "./fire";
import mapFeedsRouter from "./map-feeds";

const router: IRouter = Router();

router.use(healthRouter);
router.use(fireRouter);
router.use(mapFeedsRouter);

export default router;
