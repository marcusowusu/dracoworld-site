import express from "express";
import helmet from "helmet";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSession } from "./security.js";
import authRoutes from "./auth-routes.js";
import customerRoutes from "./customer-routes.js";
import adminRoutes from "./admin-routes.js";
import { asyncRoute, handleError, HttpError } from "./http.js";
import { pool } from "./db.js";

const app = express();
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const assetDirectory = path.join(projectRoot, "assets");

app.set("trust proxy", process.env.TRUST_PROXY === "true" ? 1 : false);
app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      formAction: ["'self'", "https://wa.me", "mailto:"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    },
  },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
}));
app.use(express.json({ limit: "16kb", strict: true }));
app.use(loadSession);

app.get(
  "/api/health",
  asyncRoute(async (_request, response) => {
    await pool.query("SELECT 1");
    response.json({ status: "ok" });
  }),
);
app.use("/api/auth", authRoutes);
app.use("/api/me", customerRoutes);
app.use("/api/admin", adminRoutes);

app.get("/", (_request, response, next) => {
  response.sendFile(path.join(projectRoot, "index.html"), (error) => {
    if (error) next(error);
  });
});
app.get("/admin.html", (_request, response, next) => {
  response.set("Cache-Control", "no-store");
  response.sendFile(path.join(projectRoot, "admin.html"), (error) => {
    if (error) next(error);
  });
});
app.get("/script.js", (_request, response, next) => {
  response.type("application/javascript");
  response.sendFile(path.join(projectRoot, "script.js"), (error) => {
    if (error) next(error);
  });
});
app.get("/account.js", (_request, response, next) => {
  response.type("application/javascript");
  response.sendFile(path.join(projectRoot, "account.js"), (error) => {
    if (error) next(error);
  });
});
app.get("/admin.js", (_request, response, next) => {
  response.type("application/javascript");
  response.sendFile(path.join(projectRoot, "admin.js"), (error) => {
    if (error) next(error);
  });
});
app.get("/styles.v1.css", (_request, response, next) => {
  response.type("text/css");
  response.sendFile(path.join(projectRoot, "styles.v1.css"), (error) => {
    if (error) next(error);
  });
});
app.use("/assets", express.static(assetDirectory, {
  dotfiles: "deny",
  fallthrough: false,
  index: false,
  maxAge: "1y",
  immutable: true,
}));

app.use((_request, _response, next) => {
  next(new HttpError(404, "not_found", "The requested resource was not found."));
});
app.use(handleError);

export default app;
