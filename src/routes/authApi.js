/**
 * routes/authApi.js
 *
 * Mounts auth endpoints on the Express router.
 *
 * Public routes  (no JWT required):
 *   POST /auth/register
 *   POST /auth/login
 *   POST /auth/refresh   <- uses httpOnly cookie, not Bearer token
 *
 * Protected routes (JWT required):
 *   POST /auth/logout
 *   GET  /auth/me
 */

import { Router } from "express";
import { requireAuth } from "../auth/authMiddleware.js";
import {
  register,
  login,
  refresh,
  logout,
  me,
} from "../auth/authController.js";

const router = Router();

router.post("/register", register);
router.post("/login", login);
router.post("/refresh", refresh);
router.post("/logout", requireAuth, logout);
router.get("/me", requireAuth, me);

export default router;
