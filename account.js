const accountButton = document.querySelector(".account-button");
const authModal = document.querySelector("#auth-modal");
const accountPanel = document.querySelector(".account-panel");
const authLoginView = document.querySelector("#auth-login-view");
const dashboardShell = document.querySelector("#dashboard-shell");
const closeButton = document.querySelector(".account-close");
const loginForm = document.querySelector("#login-form");
const registerForm = document.querySelector("#register-form");
const resetRequestForm = document.querySelector("#password-reset-request-form");
const resetForm = document.querySelector("#password-reset-form");
const inviteForm = document.querySelector("#invite-form");
const resendVerificationForm = document.querySelector("#resend-verification-form");
const profileForm = document.querySelector("#profile-form");
const logoutButton = document.querySelector("#logout-button");
const changePasswordButton = document.querySelector("#change-password");
const authViews = [...document.querySelectorAll("#auth-shell > .auth-login")];
let csrfToken = null;
let invitationToken = null;
let passwordResetToken = null;
let previousBodyOverflow = "";

class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function apiRequest(path, { method = "GET", body, csrf = false } = {}) {
  const headers = { Accept: "application/json" };
  if (method !== "GET") headers["Content-Type"] = "application/json";
  if (csrf && csrfToken) headers["X-CSRF-Token"] = csrfToken;

  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError("Could not reach the account service. Please try again later.", 0, "network_error");
  }

  const result = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(
      result?.message || "The request could not be completed. Please try again.",
      response.status,
      result?.error || "request_failed",
    );
  }
  return result;
}

function showAuthView(viewId) {
  authViews.forEach((view) => {
    view.hidden = view.id !== viewId;
  });
  if (dashboardShell) dashboardShell.hidden = true;
  accountPanel?.classList.add("is-login");
}

function setFeedback(element, message, isError = false) {
  if (!element) return;
  element.textContent = message;
  element.classList.toggle("is-error", isError);
  element.classList.toggle("is-success", Boolean(message) && !isError);
}

function formFeedback(form) {
  return form?.parentElement?.querySelector(".form-feedback")
    || form?.closest(".auth-login")?.querySelector(".form-feedback");
}

function setBusy(form, busy) {
  const submit = form?.querySelector('button[type="submit"]');
  if (submit) submit.disabled = busy;
}

function openAuthModal() {
  if (!authModal) return;
  previousBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  authModal.classList.add("is-open");
  authModal.setAttribute("aria-hidden", "false");
  closeButton?.focus();
}

function closeAuthModal() {
  if (!authModal) return;
  authModal.classList.remove("is-open");
  authModal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = previousBodyOverflow;
  accountButton?.focus();
}

function initialsFromName(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.length ? (parts[0][0] + (parts[1]?.[0] || parts[0][0])).toUpperCase() : "DW";
}

function appendText(parent, tagName, className, value) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = value;
  parent.append(element);
  return element;
}

function renderOrders(orders = []) {
  const list = document.querySelector("#order-list");
  if (!list) return;
  list.replaceChildren();
  if (orders.length === 0) {
    appendText(list, "p", "empty-state", "Your orders will appear here.");
    return;
  }

  orders.forEach((order) => {
    const article = document.createElement("article");
    article.className = "order-item account-order-item";
    const copy = document.createElement("div");
    copy.className = "order-copy";
    appendText(copy, "p", "order-meta", `Order ${order.id}`);
    appendText(copy, "h4", "", new Date(order.createdAt).toLocaleDateString("en-GB"));
    const meta = document.createElement("div");
    meta.className = "order-status-row";
    appendText(meta, "span", "status-pill payment", `${order.currency} ${Number(order.total).toFixed(2)}`);
    appendText(meta, "span", "status-pill shipping", order.status);
    appendText(meta, "span", "status-pill payment", order.paymentStatus);
    copy.append(meta);
    article.append(copy);
    list.append(article);
  });
}

function renderPreorders(preorders = []) {
  const list = document.querySelector("#preorder-list");
  if (!list) return;
  list.replaceChildren();
  const meta = document.querySelector("#preorder-meta");
  if (meta) meta.textContent = `${preorders.length} ${preorders.length === 1 ? "item" : "items"} in progress`;
  if (preorders.length === 0) {
    appendText(list, "p", "empty-state", "You currently have no active pre-orders.");
    return;
  }

  preorders.forEach((item) => {
    const article = document.createElement("article");
    article.className = "preorder-item account-preorder-item";
    const copy = document.createElement("div");
    copy.className = "preorder-copy";
    appendText(copy, "p", "order-meta", `Order ${item.id}`);
    appendText(copy, "h4", "", item.name);
    const footer = document.createElement("div");
    footer.className = "preorder-footer";
    appendText(footer, "span", "status-pill shipping", item.status);
    appendText(
      footer,
      "span",
      "",
      item.estimatedFulfillmentAt
        ? `Estimated fulfilment: ${new Date(item.estimatedFulfillmentAt).toLocaleDateString("en-GB")}`
        : "Fulfilment date to be confirmed",
    );
    copy.append(footer);
    article.append(copy);
    list.append(article);
  });
}

function renderWishlist(items = []) {
  const grid = document.querySelector("#wishlist-grid");
  if (!grid) return;
  grid.replaceChildren();
  if (items.length === 0) {
    appendText(grid, "p", "empty-state", "Your saved pieces will appear here.");
    return;
  }

  items.forEach((item) => {
    const article = document.createElement("article");
    article.className = "wishlist-item";
    const image = document.createElement("img");
    image.src = item.image;
    image.alt = item.name;
    image.loading = "lazy";
    article.append(image);
    const copy = document.createElement("div");
    copy.className = "wishlist-copy";
    appendText(copy, "h4", "", item.name);
    appendText(copy, "p", "", item.price);
    article.append(copy);
    const actions = document.createElement("div");
    actions.className = "wishlist-actions";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "mini-button";
    remove.textContent = "Remove";
    remove.addEventListener("click", async () => {
      remove.disabled = true;
      try {
        await apiRequest(`/api/me/wishlist/${encodeURIComponent(item.productId)}`, {
          method: "DELETE",
          csrf: true,
        });
        await loadDashboard();
      } catch (error) {
        remove.disabled = false;
        setFeedback(document.querySelector("#profile-feedback"), error.message, true);
      }
    });
    actions.append(remove);
    article.append(actions);
    grid.append(article);
  });
}

function renderAddresses(addresses = []) {
  const list = document.querySelector("#address-list");
  if (!list) return;
  list.replaceChildren();
  if (addresses.length === 0) {
    appendText(list, "p", "empty-state", "No addresses have been added to your account.");
    return;
  }

  addresses.forEach((address) => {
    const card = document.createElement("article");
    card.className = "address-card";
    appendText(card, "h4", "", address.recipient_name);
    if (address.is_default) appendText(card, "span", "status-pill payment", "Default");
    appendText(card, "p", "", address.address_line_1);
    if (address.address_line_2) appendText(card, "p", "", address.address_line_2);
    const locality = [address.city, address.region, address.postal_code].filter(Boolean).join(", ");
    appendText(card, "p", "", locality);
    appendText(card, "p", "", address.country);
    list.append(card);
  });
}

function renderDashboard(data) {
  const customer = data.customer;
  const name = customer.fullName || "Customer";
  const tier = customer.membership?.name || "Member";
  const points = Number(customer.rewardPoints || 0);

  const values = {
    "#dashboard-avatar": initialsFromName(name),
    "#welcome-name": `WELCOME BACK, ${name.toUpperCase()}`,
    "#member-tier": tier,
    "#account-indicator": "Verified account",
    "#membership-name": name,
    "#membership-tier-pill": tier,
    "#membership-number": customer.membershipNumber || "",
    "#membership-points": points.toLocaleString("en-US"),
    "#membership-status": "Active",
    "#total-orders": String(data.orders.length).padStart(2, "0"),
    "#active-preorders": String(data.preorders.length).padStart(2, "0"),
    "#wishlist-count": String(data.wishlist.length).padStart(2, "0"),
    "#reward-points": points.toLocaleString("en-US"),
    "#benefit-tier": tier,
    "#next-tier-progress": "Contact DracoWorld",
    "#profile-name": name,
    "#profile-email": customer.email,
    "#profile-phone": customer.phone || "",
  };
  Object.entries(values).forEach(([selector, value]) => {
    const element = document.querySelector(selector);
    if (element) {
      if (element instanceof HTMLInputElement) element.value = value;
      else element.textContent = value;
    }
  });

  renderOrders(data.orders);
  renderPreorders(data.preorders);
  renderWishlist(data.wishlist);
  renderAddresses(data.addresses);
  const dropCard = document.querySelector("#drop-card");
  if (dropCard) {
    dropCard.replaceChildren();
    appendText(dropCard, "p", "empty-state", "No upcoming collections have been announced.");
  }
}

async function loadDashboard() {
  const data = await apiRequest("/api/me/dashboard");
  renderDashboard(data);
  authLoginView.hidden = true;
  dashboardShell.hidden = false;
  accountPanel?.classList.remove("is-login");
}

async function ensureDashboardReady() {
  try {
    const session = await apiRequest("/api/auth/session");
    if (session.authenticated) {
      csrfToken = session.csrfToken;
      if (!csrfToken) {
        showAuthView("auth-login-view");
        setFeedback(document.querySelector("#auth-feedback"), "Your secure session needs to be refreshed. Sign in again.", true);
        return;
      }
      await loadDashboard();
    } else {
      csrfToken = null;
      showAuthView("auth-login-view");
    }
  } catch (error) {
    showAuthView("auth-login-view");
    setFeedback(document.querySelector("#auth-feedback"), error.message, true);
  }
}

if (accountButton) {
  accountButton.addEventListener("click", async () => {
    await ensureDashboardReady();
    openAuthModal();
  });
}

closeButton?.addEventListener("click", closeAuthModal);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && authModal?.classList.contains("is-open")) closeAuthModal();
});
authModal?.addEventListener("click", (event) => {
  if (event.target === authModal) closeAuthModal();
});

document.querySelectorAll("[data-auth-view]").forEach((button) => {
  button.addEventListener("click", () => {
    const viewId = button.dataset.authView;
    showAuthView(viewId);
    document.querySelector(`#${viewId} input`)?.focus();
  });
});

loginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!loginForm.reportValidity()) return;
  setBusy(loginForm, true);
  setFeedback(document.querySelector("#auth-feedback"), "");
  const formData = new FormData(loginForm);
  try {
    const result = await apiRequest("/api/auth/login", {
      method: "POST",
      body: {
        email: formData.get("email"),
        password: formData.get("password"),
      },
    });
    csrfToken = result.csrfToken;
    await loadDashboard();
    closeAuthModal();
  } catch (error) {
    setFeedback(document.querySelector("#auth-feedback"), error.message, true);
    if (error.code === "email_not_verified" && resendVerificationForm) {
      resendVerificationForm.hidden = false;
    }
  } finally {
    setBusy(loginForm, false);
  }
});

registerForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!registerForm.reportValidity()) return;
  setBusy(registerForm, true);
  const values = Object.fromEntries(new FormData(registerForm));
  const feedback = formFeedback(registerForm);
  try {
    const result = await apiRequest("/api/auth/register", { method: "POST", body: values });
    setFeedback(feedback, result.message);
    registerForm.reset();
  } catch (error) {
    setFeedback(feedback, error.message, true);
  } finally {
    setBusy(registerForm, false);
  }
});

resendVerificationForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const feedback = document.querySelector("#auth-feedback");
  const email = document.querySelector("#login-email")?.value;
  setBusy(resendVerificationForm, true);
  try {
    const result = await apiRequest("/api/auth/resend-verification", {
      method: "POST",
      body: { email },
    });
    setFeedback(feedback, result.message);
  } catch (error) {
    setFeedback(feedback, error.message, true);
  } finally {
    setBusy(resendVerificationForm, false);
  }
});

resetRequestForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!resetRequestForm.reportValidity()) return;
  setBusy(resetRequestForm, true);
  try {
    const result = await apiRequest("/api/auth/password-reset/request", {
      method: "POST",
      body: { email: new FormData(resetRequestForm).get("email") },
    });
    setFeedback(formFeedback(resetRequestForm), result.message);
  } catch (error) {
    setFeedback(formFeedback(resetRequestForm), error.message, true);
  } finally {
    setBusy(resetRequestForm, false);
  }
});

resetForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!passwordResetToken || !resetForm.reportValidity()) return;
  setBusy(resetForm, true);
  try {
    const result = await apiRequest("/api/auth/password-reset/confirm", {
      method: "POST",
      body: { ...Object.fromEntries(new FormData(resetForm)), token: passwordResetToken },
    });
    setFeedback(formFeedback(resetForm), result.message);
    passwordResetToken = null;
    resetForm.reset();
  } catch (error) {
    setFeedback(formFeedback(resetForm), error.message, true);
  } finally {
    setBusy(resetForm, false);
  }
});

async function loadInvitation(token) {
  const detail = document.querySelector("#invite-details");
  try {
    const invitation = await apiRequest(`/api/auth/invitations/${encodeURIComponent(token)}`);
    const emailInput = inviteForm?.querySelector('input[name="email"]');
    if (emailInput) emailInput.value = invitation.email;
    if (detail) detail.textContent = `You are invited as a ${invitation.tierName} member.`;
    if (inviteForm) inviteForm.hidden = false;
  } catch (error) {
    if (detail) detail.textContent = error.message;
    setFeedback(formFeedback(inviteForm), error.message, true);
  }
}

inviteForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!invitationToken || !inviteForm.reportValidity()) return;
  setBusy(inviteForm, true);
  const formData = new FormData(inviteForm);
  try {
    const result = await apiRequest(
      `/api/auth/invitations/${encodeURIComponent(invitationToken)}/accept`,
      {
        method: "POST",
        body: {
          fullName: formData.get("fullName"),
          password: formData.get("password"),
          passwordConfirmation: formData.get("passwordConfirmation"),
        },
      },
    );
    invitationToken = null;
    csrfToken = result.csrfToken;
    await loadDashboard();
  } catch (error) {
    setFeedback(formFeedback(inviteForm), error.message, true);
  } finally {
    setBusy(inviteForm, false);
  }
});

profileForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!profileForm.reportValidity()) return;
  const feedback = document.querySelector("#profile-feedback");
  const fullName = document.querySelector("#profile-name")?.value.trim();
  const phone = document.querySelector("#profile-phone")?.value.trim() || "";
  setBusy(profileForm, true);
  try {
    await apiRequest("/api/me/profile", {
      method: "PATCH",
      body: { fullName, phone },
      csrf: true,
    });
    await loadDashboard();
    setFeedback(feedback, "Your profile has been updated.");
  } catch (error) {
    setFeedback(feedback, error.message, true);
  } finally {
    setBusy(profileForm, false);
  }
});

changePasswordButton?.addEventListener("click", () => {
  showAuthView("reset-request-view");
  const emailInput = resetRequestForm?.querySelector('input[name="email"]');
  const profileEmail = document.querySelector("#profile-email");
  if (emailInput && profileEmail) emailInput.value = profileEmail.value;
});

logoutButton?.addEventListener("click", async () => {
  logoutButton.disabled = true;
  try {
    await apiRequest("/api/auth/logout", { method: "POST", body: {}, csrf: true });
    csrfToken = null;
    showAuthView("auth-login-view");
  } catch (error) {
    setFeedback(document.querySelector("#profile-feedback"), error.message, true);
  } finally {
    logoutButton.disabled = false;
  }
});

document.querySelectorAll(".nav-item[data-target]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".nav-item[data-target]").forEach((item) => {
      const active = item === button;
      item.classList.toggle("is-active", active);
      if (active) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    });
    document.getElementById(button.dataset.target)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  });
});

const query = new URLSearchParams(window.location.search);
const inviteFromUrl = query.get("invite");
passwordResetToken = query.get("reset_token");
const verifiedFromUrl = query.get("verified") === "1";
const accountFromUrl = query.get("account") === "1";
if (inviteFromUrl || passwordResetToken || verifiedFromUrl || accountFromUrl) {
  history.replaceState(null, "", `${window.location.pathname}${window.location.hash}`);
  openAuthModal();
  if (inviteFromUrl) {
    invitationToken = inviteFromUrl;
    showAuthView("invite-view");
    loadInvitation(inviteFromUrl);
  } else if (passwordResetToken) {
    showAuthView("password-reset-view");
  } else if (accountFromUrl) {
    showAuthView("auth-login-view");
  } else {
    void ensureDashboardReady();
  }
}
