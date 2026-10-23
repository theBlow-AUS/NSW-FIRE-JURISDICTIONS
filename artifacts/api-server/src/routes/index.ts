import { Router, type IRouter } from "express";
import healthRouter from "./health";
import fireRouter from "./fire";

const router: IRouter = Router();

router.use(healthRouter);
router.use(fireRouter);

export default router;
