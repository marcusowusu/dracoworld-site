import { Router } from "express";
import { z } from "zod";
import { pool } from "./db.js";
import {
  asyncRoute,
  requireAuth,
  requireCsrf,
  requireJsonOrigin,
} from "./http.js";

const router = Router();
const profileSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().max(40).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "Provide at least one profile field to update.",
});
const productIds = [
  "logo-sleeve-sweatshirt",
  "raglan-tee-black",
  "raglan-tee-cream",
  "raglan-tee-white",
];
const productSchema = z.object({
  productId: z.enum(productIds),
}).strict();

const products = new Map([
  ["logo-sleeve-sweatshirt", {
    name: "Logo Sleeve Sweatshirt",
    image: "/assets/sweatshirt.png",
    price: "GH₵250",
  }],
  ["raglan-tee-black", {
    name: "Raglan Tee — Black",
    image: "/assets/dracoworld-tee-black.jpeg",
    price: "GH₵150",
  }],
  ["raglan-tee-cream", {
    name: "Raglan Tee — Cream",
    image: "/assets/dracoworld-tee-cream.jpeg",
    price: "GH₵150",
  }],
  ["raglan-tee-white", {
    name: "Raglan Tee — White",
    image: "/assets/dracoworld-tee-white.jpeg",
    price: "GH₵150",
  }],
]);

router.use(requireAuth);

router.get(
  "/dashboard",
  asyncRoute(async (request, response) => {
    const customerId = request.auth.customer.id;
    const [orders, preorders, addresses, wishlist] = await Promise.all([
      pool.query(
        `SELECT id, external_reference, status, payment_status, total_amount, currency, created_at
         FROM customer_orders WHERE customer_id = $1 ORDER BY created_at DESC`,
        [customerId],
      ),
      pool.query(
        `SELECT id, external_reference, product_name, status, estimated_fulfillment_at, created_at
         FROM customer_preorders WHERE customer_id = $1 ORDER BY created_at DESC`,
        [customerId],
      ),
      pool.query(
        `SELECT id, recipient_name, address_line_1, address_line_2, city, region,
                postal_code, country, is_default
         FROM customer_addresses WHERE customer_id = $1 ORDER BY is_default DESC, created_at DESC`,
        [customerId],
      ),
      pool.query(
        `SELECT product_id, created_at FROM customer_wishlist
         WHERE customer_id = $1 ORDER BY created_at DESC`,
        [customerId],
      ),
    ]);

    response.json({
      customer: {
        id: request.auth.customer.id,
        fullName: request.auth.customer.fullName,
        email: request.auth.customer.email,
        phone: request.auth.customer.phone,
        membershipNumber: request.auth.customer.membershipNumber,
        role: request.auth.customer.role,
        rewardPoints: request.auth.customer.rewardPoints,
        membership: {
          code: request.auth.customer.tierCode,
          name: request.auth.customer.tierName,
          pointsMultiplier: Number(request.auth.customer.pointsMultiplier),
        },
      },
      orders: orders.rows.map((order) => ({
        id: order.external_reference,
        status: order.status,
        paymentStatus: order.payment_status,
        total: Number(order.total_amount),
        currency: order.currency,
        createdAt: order.created_at,
      })),
      preorders: preorders.rows.map((item) => ({
        id: item.external_reference,
        name: item.product_name,
        status: item.status,
        estimatedFulfillmentAt: item.estimated_fulfillment_at,
        createdAt: item.created_at,
      })),
      addresses: addresses.rows,
      wishlist: wishlist.rows.map((item) => ({
        productId: item.product_id,
        ...products.get(item.product_id),
        createdAt: item.created_at,
      })),
    });
  }),
);

router.patch(
  "/profile",
  requireJsonOrigin,
  requireCsrf,
  asyncRoute(async (request, response) => {
    const input = profileSchema.parse(request.body);
    const current = request.auth.customer;
    const fullName = input.fullName ?? current.fullName;
    const phone = input.phone ?? current.phone;
    const { rows } = await pool.query(
      `UPDATE customers SET full_name = $1, phone = $2, updated_at = now()
       WHERE id = $3 AND status = 'active'
       RETURNING id, full_name, email, phone`,
      [fullName, phone, current.id],
    );
    response.json({
      profile: {
        id: rows[0].id,
        fullName: rows[0].full_name,
        email: rows[0].email,
        phone: rows[0].phone,
      },
    });
  }),
);

router.post(
  "/wishlist",
  requireJsonOrigin,
  requireCsrf,
  asyncRoute(async (request, response) => {
    const { productId } = productSchema.parse(request.body);
    await pool.query(
      `INSERT INTO customer_wishlist (customer_id, product_id)
       VALUES ($1, $2) ON CONFLICT (customer_id, product_id) DO NOTHING`,
      [request.auth.customer.id, productId],
    );
    response.status(201).json({ productId });
  }),
);

router.delete(
  "/wishlist/:productId",
  requireJsonOrigin,
  requireCsrf,
  asyncRoute(async (request, response) => {
    const productId = z.enum(productIds).parse(request.params.productId);
    await pool.query(
      "DELETE FROM customer_wishlist WHERE customer_id = $1 AND product_id = $2",
      [request.auth.customer.id, productId],
    );
    response.status(204).end();
  }),
);

export default router;
