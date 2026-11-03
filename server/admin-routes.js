import { Router } from "express";
import { z } from "zod";
import { inTransaction, pool } from "./db.js";
import {
  asyncRoute,
  HttpError,
  rateLimit,
  requireAdmin,
  requireAuth,
  requireCsrf,
  requireJsonOrigin,
} from "./http.js";
import { requireEmailConfiguration, sendInvitationEmail } from "./email.js";
import { createOpaqueToken, digest } from "./security.js";

const router = Router();
const emailSchema = z.string().trim().email().max(254).transform((email) => email.toLowerCase());
const invitationSchema = z.object({
  email: emailSchema,
  membershipTierId: z.string().uuid(),
  expiresAt: z.string().datetime({ offset: true }),
}).strict();
const inviteRateLimit = rateLimit({
  scope: "admin-invitation",
  max: 20,
  windowMs: 60 * 60 * 1000,
  identity: (request) => `${request.ip}:${request.auth?.customer.id || ""}`,
});

router.use(requireAuth, requireAdmin);

router.get(
  "/membership-tiers",
  asyncRoute(async (_request, response) => {
    const { rows } = await pool.query(
      `SELECT id, code, name, description
       FROM membership_tiers WHERE invitation_assignable = TRUE ORDER BY name`,
    );
    response.json({ tiers: rows });
  }),
);

router.get(
  "/invitations",
  asyncRoute(async (_request, response) => {
    await pool.query(
      `UPDATE invitations SET status = 'expired'
       WHERE status = 'pending' AND expires_at <= now()`,
    );
    const { rows } = await pool.query(
      `SELECT i.id, i.email, i.status, i.expires_at, i.created_at, i.accepted_at,
              mt.name AS membership_tier, creator.email AS created_by_email,
              accepted.email AS accepted_by_email
       FROM invitations i
       JOIN membership_tiers mt ON mt.id = i.membership_tier_id
       JOIN customers creator ON creator.id = i.created_by
       LEFT JOIN customers accepted ON accepted.id = i.accepted_by
       ORDER BY i.created_at DESC
       LIMIT 250`,
    );
    response.json({ invitations: rows });
  }),
);

router.post(
  "/invitations",
  requireJsonOrigin,
  requireCsrf,
  inviteRateLimit,
  asyncRoute(async (request, response) => {
    const input = invitationSchema.parse(request.body);
    const expiresAt = new Date(input.expiresAt);
    const maxExpiry = Date.now() + 90 * 24 * 60 * 60 * 1000;
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now() || expiresAt.getTime() > maxExpiry) {
      throw new HttpError(400, "invalid_expiry", "Choose an expiry date within the next 90 days.");
    }
    requireEmailConfiguration();

    const invitation = await inTransaction(async (client) => {
      await client.query(
        `UPDATE invitations SET status = 'expired'
         WHERE status = 'pending' AND expires_at <= now()`,
      );
      const { rows: customerRows } = await client.query(
        "SELECT 1 FROM customers WHERE email = $1",
        [input.email],
      );
      if (customerRows[0]) {
        throw new HttpError(409, "customer_already_registered", "This email already belongs to a customer account.");
      }

      const { rows: pendingRows } = await client.query(
        "SELECT 1 FROM invitations WHERE lower(email) = $1 AND status = 'pending'",
        [input.email],
      );
      if (pendingRows[0]) {
        throw new HttpError(409, "invitation_already_pending", "There is already an active invitation for this email.");
      }

      const { rows: tierRows } = await client.query(
        `SELECT id, name FROM membership_tiers
         WHERE id = $1 AND invitation_assignable = TRUE`,
        [input.membershipTierId],
      );
      if (!tierRows[0]) {
        throw new HttpError(400, "membership_tier_unavailable", "Choose an authorized membership tier.");
      }

      const token = createOpaqueToken();
      const { rows } = await client.query(
        `INSERT INTO invitations (email, token_hash, membership_tier_id, expires_at, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, email, expires_at`,
        [input.email, digest(token), tierRows[0].id, expiresAt, request.auth.customer.id],
      );
      return { ...rows[0], tierName: tierRows[0].name, token };
    });

    try {
      await sendInvitationEmail({
        email: invitation.email,
        tierName: invitation.tierName,
        token: invitation.token,
        expiresAt: invitation.expires_at,
      });
    } catch (error) {
      await pool.query(
        `UPDATE invitations SET status = 'revoked', revoked_at = now()
         WHERE id = $1 AND status = 'pending'`,
        [invitation.id],
      );
      throw error;
    }
    response.status(201).json({
      invitation: {
        id: invitation.id,
        email: invitation.email,
        tierName: invitation.tierName,
        expiresAt: invitation.expires_at,
        status: "pending",
      },
    });
  }),
);

router.post(
  "/invitations/:id/revoke",
  requireJsonOrigin,
  requireCsrf,
  inviteRateLimit,
  asyncRoute(async (request, response) => {
    const id = z.string().uuid().parse(request.params.id);
    await pool.query(
      `UPDATE invitations SET status = 'expired'
       WHERE id = $1 AND status = 'pending' AND expires_at <= now()`,
      [id],
    );
    const { rowCount } = await pool.query(
      `UPDATE invitations SET status = 'revoked', revoked_at = now()
       WHERE id = $1 AND status = 'pending' AND expires_at > now()`,
      [id],
    );
    if (rowCount === 0) {
      throw new HttpError(409, "invitation_not_revocable", "Only an unused, unexpired invitation can be revoked.");
    }
    response.status(204).end();
  }),
);

export default router;
